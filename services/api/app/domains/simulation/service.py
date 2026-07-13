"""가상 회사 직무 시뮬레이션 — 하루 일과형 + 돌발 퀘스트.

[자유 대화] NPC 페르소나 + 현재 상태값 → LLM 스트리밍 → scoring이 delta 평가
[과제 제출] AI 채점 → 통과 시 다음 스텝 / 미달 시 힌트 3단계(조언 카드)
[돌발 퀘스트] 스텝 전환 시 확률 발동(마지막 전환에서 미발동이면 강제) — 실패해도 진행 비차단
→ 모든 행동 action_logs 적재 → 리포트 재료
"""

import logging
import random
from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.content.knowledge import search_knowledge
from app.domains.coach import service as coach
from app.domains.scoring import aggregate
from app.domains.scoring import service as scoring
from app.domains.simulation import hints
from app.domains.simulation import state_machine as sm
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Job, Message, NpcPersona, Scenario, Simulation, User

logger = logging.getLogger(__name__)

MEMORY_TURNS = 20
SCORING_TURNS = 40  # 채점 대화록 상한 — 하루 종일 대화해도 채점 프롬프트가 무한 성장하지 않게
RAG_TOP_K = 3
RAG_MAX_DISTANCE = 0.4  # Gemini 임베딩은 거리대가 좁음(관련 ~0.2, 무관 ~0.28) — eval로 재튜닝 대상


async def create_simulation(
    session: AsyncSession, user: User, scenario_slug: str
) -> tuple[Simulation, Scenario]:
    scenario = (
        await session.execute(select(Scenario).where(Scenario.slug == scenario_slug))
    ).scalar_one_or_none()
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"시나리오 없음: {scenario_slug}")

    state = {
        **scenario.initial_state,  # 먼저 펼치고, 엔진 예약 키가 항상 이긴다 (clobber 방지)
        "step": scenario.steps[0]["id"],
        "attempts": {},  # 스텝별 과제 제출 횟수 → 힌트 단계·리포트 재료
        "quest": {"status": "pending" if scenario.sudden_quest else "none", "attempts": 0},
    }
    simulation = Simulation(user_id=user.id, scenario_id=scenario.id, state=state)
    session.add(simulation)
    await session.commit()
    await session.refresh(simulation)
    return simulation, scenario


async def get_owned_simulation(
    session: AsyncSession, simulation_id: int, user: User
) -> tuple[Simulation, Scenario]:
    simulation = await session.get(Simulation, simulation_id)
    if simulation is None or simulation.user_id != user.id:
        raise HTTPException(status_code=404, detail="시뮬레이션을 찾을 수 없음")
    scenario = await session.get(Scenario, simulation.scenario_id)
    return simulation, scenario


def public_state(state: dict) -> dict:
    """클라이언트로 나가는 state — 미발동 돌발 퀘스트는 서프라이즈라 숨김.

    to_out뿐 아니라 WS의 npc_reply/state_updated/task_result 프레임도 전부 이걸 거쳐야
    한다 (raw state를 흘리면 quest.status=='pending'으로 존재가 스포일러됨).
    active부터는 재접속 UX 위해 노출.
    """
    out = dict(state)
    quest = out.get("quest")
    if isinstance(quest, dict) and quest.get("status") == "pending":
        out["quest"] = {"status": "none", "attempts": 0}
    return out


def _resolve_step(scenario: Scenario, state: dict) -> dict:
    """state['step']이 시나리오 재생성으로 사라졌으면 첫 스텝으로 복구 (영구 브릭 방지)."""
    step_ids = {s["id"] for s in scenario.steps}
    if state["step"] not in step_ids:
        logger.warning(
            "스텝 '%s'가 시나리오 %s에 없음 — 첫 스텝으로 복구", state["step"], scenario.slug
        )
        state["step"] = scenario.steps[0]["id"]
    return sm.find_step(scenario.steps, state["step"])


def to_out(simulation: Simulation, scenario: Scenario) -> dict:
    step = _resolve_step(scenario, simulation.state)
    return {
        "id": simulation.id,
        "scenario_slug": scenario.slug,
        "scenario_title": scenario.title,
        "module": scenario.module,  # 프론트 배경 8세트 선택용
        "status": simulation.status,
        "state": public_state(simulation.state),
        "step": sm.public_step(step),
        "created_at": simulation.created_at,
    }


def _ensure_active(simulation: Simulation) -> None:
    if simulation.status != "active":
        raise HTTPException(status_code=409, detail="이미 종료된 시뮬레이션")


async def _update_state(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    deltas: dict,
) -> tuple[dict, str | None]:
    """delta 적용 + 전이 평가 → (새 상태, 바뀐 스텝 id 또는 None).

    돌발 퀘스트 진행 중에는 상태값 누적만 하고 스텝 전이는 보류 —
    퀘스트 중 대화/선택으로 본편 스텝이 몰래 넘어가는 것을 방지.
    """
    prev_step = simulation.state["step"]
    new_state = sm.apply_deltas(simulation.state, deltas)
    quest_active = (simulation.state.get("quest") or {}).get("status") == "active"
    new_step = (
        prev_step if quest_active else sm.resolve_transitions(scenario.steps, prev_step, new_state)
    )
    new_state["step"] = new_step
    simulation.state = new_state
    flag_modified(simulation, "state")  # JSONB 전체 교체 감지
    await session.flush()
    return new_state, (new_step if new_step != prev_step else None)


async def stream_npc_chat(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    npc_name: str,
    user_text: str,
) -> AsyncIterator[tuple[str, object]]:
    """NPC 대화 처리 — ("token", str) 조각들 후 ("final", dict) 하나를 yield."""
    _ensure_active(simulation)
    step = _resolve_step(scenario, simulation.state)
    allowed = set(step.get("npcs", []))
    quest = simulation.state.get("quest") or {}
    if quest.get("status") == "active" and scenario.sudden_quest:
        allowed.add(scenario.sudden_quest.get("npc"))  # 퀘스트 NPC와도 대화 가능
    if npc_name not in allowed:
        raise HTTPException(status_code=400, detail=f"현재 스텝에 없는 NPC: {npc_name}")

    persona = (
        await session.execute(
            select(NpcPersona).where(
                NpcPersona.scenario_id == scenario.id, NpcPersona.name == npc_name
            )
        )
    ).scalar_one_or_none()
    if persona is None:
        raise HTTPException(status_code=404, detail=f"NPC 페르소나 없음: {npc_name}")

    # 사용자 발화 저장
    session.add(Message(simulation_id=simulation.id, role="user", content=user_text))
    await session.commit()

    # 최근 대화 + NPC 시스템 프롬프트
    history = list(
        (
            await session.execute(
                select(Message)
                .where(Message.simulation_id == simulation.id)
                .order_by(Message.id)
            )
        ).scalars()
    )[-MEMORY_TURNS:]
    context = [
        ChatMessage(
            role="user" if m.role == "user" else "assistant",
            content=m.content if m.role == "user" else f"[{m.role}] {m.content}",
        )
        for m in history
    ]
    # RAG: 발화 관련 직무 지식을 NPC 프롬프트에 주입 (Gemini 임베딩, doc_chunks).
    # 반드시 이 시나리오 직무로 스코프 — 안 그러면 다른 직무의 지식이 끼어들어(거리 컷 안에)
    # NPC가 엉뚱한 업무를 근거로 답한다. 매칭 지식이 없으면 주입 없음(안전).
    job = await session.get(Job, scenario.job_id)
    chunks = await search_knowledge(
        session, user_text, job_code=(job.code if job else None),
        top_k=RAG_TOP_K, max_distance=RAG_MAX_DISTANCE,
    )
    knowledge = (
        "\n\n".join(f"[{c.source}]\n{c.content}" for c in chunks) if chunks else None
    )
    system = render_prompt(
        "npc/system.md",
        persona_prompt=persona.system_prompt,
        mission=step["mission"],
        name=persona.name,
        rank=persona.rank,
        state=simulation.state,
        knowledge=knowledge,
    )

    full: list[str] = []
    # NPC는 사실 그라운딩과 역할 일관성을 우선하므로 창의성을 낮게 유지한다.
    async for chunk in get_llm().chat_stream(context, system=system, temperature=0.3):
        full.append(chunk)
        yield ("token", chunk)
    npc_reply = "".join(full)

    # 사용자가 이미 스트림으로 본 답변이므로 먼저 확정 저장한다 — 이후 평가가 실패해도
    # 대화록(채점·NPC 기억의 근거)이 사용자가 본 것과 어긋나지 않게.
    session.add(
        Message(simulation_id=simulation.id, role=f"npc:{npc_name}", content=npc_reply)
    )
    await session.commit()

    # 발언 영향 평가 → 상태 갱신 → 전이. LLM 평가는 실패할 수 있으므로(실키 오류/JSON 파싱)
    # best-effort: 실패해도 대화는 유지하고 상태 전이만 생략, 소켓은 정상 final 프레임으로 종료.
    deltas: dict = {}
    changed_step = None
    new_state = dict(simulation.state)
    try:
        deltas, reason = await scoring.evaluate_chat(step["mission"], user_text, npc_reply)
        new_state, changed_step = await _update_state(session, simulation, scenario, deltas)
        await scoring.log_action(
            session, simulation.id, "chat",
            {"npc": npc_name, "user_text": user_text, "reason": reason}, deltas,
        )
        await session.commit()
    except Exception:  # noqa: BLE001 — 평가 실패가 확정된 대화를 되돌리거나 소켓을 죽이면 안 됨
        await session.rollback()
        logger.exception("발언 영향 평가 실패 (simulation=%d) — 대화 유지, 전이 생략", simulation.id)

    yield (
        "final",
        {
            "npc": npc_name,
            "content": npc_reply,
            "delta": deltas,
            "state": public_state(new_state),
            "step_changed": (
                sm.public_step(sm.find_step(scenario.steps, changed_step))
                if changed_step
                else None
            ),
        },
    )


async def submit_choice(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    choice_id: str,
) -> dict:
    """선택지 제출 — 룰 기반 effects 적용."""
    _ensure_active(simulation)
    step = _resolve_step(scenario, simulation.state)
    effects = scoring.choice_effects(step, choice_id)

    new_state, changed_step = await _update_state(session, simulation, scenario, effects)
    await scoring.log_action(
        session, simulation.id, "choice", {"step": step["id"], "choice_id": choice_id}, effects
    )
    await session.commit()

    return {
        "delta": effects,
        "state": public_state(new_state),
        "step_changed": (
            sm.public_step(sm.find_step(scenario.steps, changed_step))
            if changed_step
            else None
        ),
    }


async def _transcript(session: AsyncSession, simulation_id: int) -> str:
    """대화에서 실제로 정보를 수집했는지 채점에 반영하기 위한 대화록."""
    history = list(
        (
            await session.execute(
                select(Message)
                .where(Message.simulation_id == simulation_id)
                .order_by(Message.id)
            )
        ).scalars()
    )
    return "\n".join(
        f"{'사용자' if m.role == 'user' else m.role}: {m.content}"
        for m in history[-SCORING_TURNS:]
    )


async def _grade(
    session: AsyncSession, simulation: Simulation, mission: str, task: dict, submission: str | list
) -> dict:
    """채점 라우팅 — 선택·배열형은 룰 채점(결정적), 서술형은 대화록 포함 LLM 채점."""
    if task.get("kind") in scoring.RULE_KINDS:
        return scoring.grade_structured(task, submission)
    transcript = await _transcript(session, simulation.id)
    return await scoring.evaluate_task(mission, task, transcript, str(submission))


def _envelope(
    result: dict,
    state: dict,
    *,
    advice: dict | None = None,
    step_changed: dict | None = None,
    completed: bool = False,
    sudden_quest: dict | None = None,
    is_quest: bool = False,
    **extra,
) -> dict:
    """제출 응답 계약 — 라우터가 pop하는 키들의 단일 정의처 (본편·퀘스트 공용)."""
    return {
        **result,
        "advice_card": advice,
        "state": public_state(state),  # 미발동 퀘스트 스포일러 마스킹
        "step_changed": step_changed,
        "completed": completed,
        "sudden_quest": sudden_quest,
        "is_quest": is_quest,
        **extra,
    }


def _public_quest(quest_def: dict) -> dict:
    """클라이언트용 퀘스트 정보 — 정답(hints·answer)은 숨김."""
    return {
        "npc": quest_def.get("npc"),
        "intro": quest_def.get("intro"),
        "task": sm.public_task(quest_def["task"]),
    }


async def submit_task(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    submission: str | list,
) -> dict:
    """과제 제출 — 채점(룰 또는 AI) → 통과 시 다음 스텝 / 미달 시 조언 카드(힌트 3단계).

    돌발 퀘스트가 활성 상태면 제출은 퀘스트 채점으로 라우팅된다.
    스텝 전환 성공 시 돌발 퀘스트 발동을 판정한다 (시뮬레이션당 1회 보장).
    """
    _ensure_active(simulation)
    state = dict(simulation.state)
    quest = dict(state.get("quest") or {"status": "none", "attempts": 0})

    if quest.get("status") == "active":
        return await _submit_quest(session, simulation, scenario, submission, state, quest)

    step = _resolve_step(scenario, state)
    task = step.get("task")
    if not task:
        raise HTTPException(status_code=400, detail="현재 스텝에 과제가 없음")

    result = await _grade(session, simulation, step["mission"], task, submission)

    attempts = dict(state.get("attempts") or {})
    attempts[step["id"]] = attempts.get(step["id"], 0) + 1
    attempt_n = attempts[step["id"]]

    advice = None
    step_changed = None
    completed = False
    quest_fired = None

    if result["passed"]:
        if task["on_pass"] == sm.END:
            simulation.status = "completed"
            completed = True
        else:
            next_id = task["on_pass"]
            state["step"] = next_id
            next_step = sm.find_step(scenario.steps, next_id)
            step_changed = sm.public_step(next_step)
            # 돌발 퀘스트 발동 판정 (전환 시점 확률 50%, 종착 스텝 진입까지 미발동이면 강제)
            if scenario.sudden_quest and hints.should_fire_quest(
                next_step, quest.get("status", "none"), random.random()
            ):
                quest = {"status": "active", "attempts": 0}
                quest_fired = _public_quest(scenario.sudden_quest)
    else:
        advice = hints.advice_card(task, attempt_n, result["scores"], result["feedback"])

    state["attempts"] = attempts
    state["quest"] = quest
    simulation.state = state
    flag_modified(simulation, "state")

    await scoring.log_action(
        session,
        simulation.id,
        "task_submit",
        {
            "step": step["id"],
            "attempt": attempt_n,
            "submission": submission,
            "total": result["total"],
            "passed": result["passed"],
            "feedback": result["feedback"],
            "hint_level": advice["level"] if advice else 0,
        },
        {},
    )
    await session.commit()
    if completed:
        try:
            await finalize_score(session, simulation, scenario)  # 백분위 모수 스냅샷
        except Exception:  # noqa: BLE001 — 스냅샷 실패가 성공한 제출을 500으로 만들면 안 됨
            logger.exception("점수 스냅샷 실패 (simulation=%d) — GET /score는 재집계로 동작", simulation.id)

    # AI 코치: 서술형 통과 시 완료당 1회, 제출물 사후 리뷰 (선택·배열형은 리뷰할 글이 없음)
    coach_cards = None
    if result["passed"] and task.get("kind") not in scoring.RULE_KINDS:
        coach_cards = await coach.generate_cards(coach.build_vars(
            simulation_id=simulation.id, scenario_slug=scenario.slug,
            step=step, task=task, submission=submission, result=result, attempt=attempt_n,
        ))

    return _envelope(
        result,
        simulation.state,
        advice=advice,
        step_changed=step_changed,
        completed=completed,
        sudden_quest=quest_fired,
        coach=coach_cards,
    )


QUEST_MAX_ATTEMPTS = 2  # 실패해도 진행 비차단 — 2회 미달이면 종료하고 리포트에만 반영


async def _submit_quest(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    submission: str,
    state: dict,
    quest: dict,
) -> dict:
    """돌발 퀘스트 제출 채점 — 통과 or 2회 미달 시 퀘스트 종료 후 본편 복귀."""
    quest_def = scenario.sudden_quest
    qtask = quest_def["task"]
    # 채점 기준점(mission)은 서사(intro)가 아니라 과제 지시문 — 루브릭이 흔들리지 않게
    result = await _grade(
        session, simulation, qtask.get("mission") or qtask["prompt"], qtask, submission
    )

    quest["attempts"] = quest.get("attempts", 0) + 1
    advice = None
    if result["passed"]:
        quest["status"] = "passed"
    elif quest["attempts"] >= QUEST_MAX_ATTEMPTS:
        quest["status"] = "failed"
    else:
        advice = hints.advice_card(qtask, quest["attempts"], result["scores"], result["feedback"])

    state["quest"] = quest
    simulation.state = state
    flag_modified(simulation, "state")

    await scoring.log_action(
        session,
        simulation.id,
        "quest_submit",
        {
            "attempt": quest["attempts"],
            "submission": submission,
            "total": result["total"],
            "passed": result["passed"],
            "feedback": result["feedback"],
            "quest_status": quest["status"],
        },
        {},
    )
    await session.commit()

    coach_cards = None
    if result["passed"] and qtask.get("kind") not in scoring.RULE_KINDS:
        quest_step = {"id": "quest", "title": "돌발 퀘스트", "mission": quest_def.get("intro", "")}
        coach_cards = await coach.generate_cards(coach.build_vars(
            simulation_id=simulation.id, scenario_slug=scenario.slug,
            step=quest_step, task=qtask, submission=submission, result=result,
            attempt=quest["attempts"],
        ))

    return _envelope(
        result,
        simulation.state,
        advice=advice,
        is_quest=True,
        quest_status=quest["status"],
        coach=coach_cards,
    )


async def finalize_score(
    session: AsyncSession, simulation: Simulation, scenario: Scenario
) -> None:
    """완료 시점 점수 스냅샷 — state['score']에 저장 (백분위 비교 모수가 됨).

    호출 전에 반드시 로그가 커밋돼 있어야 함 (집계가 DB를 읽으므로).
    """
    score = await aggregate.simulation_score(session, simulation, scenario)
    state = dict(simulation.state)
    state["score"] = {
        "total": score["total"],
        "mission_avg": score["mission_avg"],
        "competencies": score["competencies"],
    }
    simulation.state = state
    flag_modified(simulation, "state")
    await session.commit()


async def finish_simulation(
    session: AsyncSession, simulation: Simulation, scenario: Scenario
) -> Simulation:
    """중도 종료(포기) — 진짜 완주(__end__ 과제 통과)와 구분해 aborted 처리.

    점수 스냅샷을 남기지 않으므로 백분위 모수(완주자 풀)를 오염시키지 않는다.
    """
    _ensure_active(simulation)
    simulation.status = "aborted"
    await scoring.log_action(session, simulation.id, "finish", {}, {})
    await session.commit()
    await session.refresh(simulation)
    return simulation
