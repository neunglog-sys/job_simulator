"""가상 회사 직무 시뮬레이션 — 설계서 §6-② 루프.

[자유 대화] NPC 페르소나 + 현재 상태값 → LLM 스트리밍 → scoring이 delta 평가
[행동]     선택지 제출 → YAML effects 룰 적용
→ 상태 갱신 → 전이 조건 충족 시 다음 스텝 → action_logs 적재
"""

from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.domains.scoring import service as scoring
from app.domains.simulation import state_machine as sm
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Message, NpcPersona, Scenario, Simulation, User

MEMORY_TURNS = 20


async def create_simulation(
    session: AsyncSession, user: User, scenario_slug: str
) -> tuple[Simulation, Scenario]:
    scenario = (
        await session.execute(select(Scenario).where(Scenario.slug == scenario_slug))
    ).scalar_one_or_none()
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"시나리오 없음: {scenario_slug}")

    state = {"step": scenario.steps[0]["id"], **scenario.initial_state}
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


def to_out(simulation: Simulation, scenario: Scenario) -> dict:
    step = sm.find_step(scenario.steps, simulation.state["step"])
    return {
        "id": simulation.id,
        "scenario_slug": scenario.slug,
        "scenario_title": scenario.title,
        "status": simulation.status,
        "state": simulation.state,
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
    """delta 적용 + 전이 평가 → (새 상태, 바뀐 스텝 id 또는 None)."""
    prev_step = simulation.state["step"]
    new_state = sm.apply_deltas(simulation.state, deltas)
    new_step = sm.resolve_transitions(scenario.steps, prev_step, new_state)
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
    step = sm.find_step(scenario.steps, simulation.state["step"])
    if npc_name not in step.get("npcs", []):
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
    system = render_prompt(
        "npc/system.md",
        persona_prompt=persona.system_prompt,
        mission=step["mission"],
        name=persona.name,
        rank=persona.rank,
        state=simulation.state,
        knowledge=None,  # TODO: RAG(doc_chunks) 연동 시 주입
    )

    full: list[str] = []
    async for chunk in get_llm().chat_stream(context, system=system):
        full.append(chunk)
        yield ("token", chunk)
    npc_reply = "".join(full)

    session.add(
        Message(simulation_id=simulation.id, role=f"npc:{npc_name}", content=npc_reply)
    )

    # 발언 영향 평가 → 상태 갱신 → 전이
    deltas, reason = await scoring.evaluate_chat(step["mission"], user_text, npc_reply)
    new_state, changed_step = await _update_state(session, simulation, scenario, deltas)
    await scoring.log_action(
        session,
        simulation.id,
        "chat",
        {"npc": npc_name, "user_text": user_text, "reason": reason},
        deltas,
    )
    await session.commit()

    yield (
        "final",
        {
            "npc": npc_name,
            "content": npc_reply,
            "delta": deltas,
            "state": new_state,
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
    step = sm.find_step(scenario.steps, simulation.state["step"])
    effects = scoring.choice_effects(step, choice_id)

    new_state, changed_step = await _update_state(session, simulation, scenario, effects)
    await scoring.log_action(
        session, simulation.id, "choice", {"step": step["id"], "choice_id": choice_id}, effects
    )
    await session.commit()

    return {
        "delta": effects,
        "state": new_state,
        "step_changed": (
            sm.public_step(sm.find_step(scenario.steps, changed_step))
            if changed_step
            else None
        ),
    }


async def submit_task(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    submission: str,
) -> dict:
    """과제 제출 — AI 채점 → 통과 시 다음 스텝(마지막이면 완료), 미달 시 피드백."""
    _ensure_active(simulation)
    step = sm.find_step(scenario.steps, simulation.state["step"])
    task = step.get("task")
    if not task:
        raise HTTPException(status_code=400, detail="현재 스텝에 과제가 없음")

    # 대화에서 실제로 정보를 수집했는지 채점에 반영하기 위해 대화록 제공
    history = list(
        (
            await session.execute(
                select(Message)
                .where(Message.simulation_id == simulation.id)
                .order_by(Message.id)
            )
        ).scalars()
    )
    transcript = "\n".join(
        f"{'사용자' if m.role == 'user' else m.role}: {m.content}" for m in history
    )

    result = await scoring.evaluate_task(step["mission"], task, transcript, submission)

    step_changed = None
    completed = False
    if result["passed"]:
        if task["on_pass"] == sm.END:
            simulation.status = "completed"
            completed = True
        else:
            new_state = dict(simulation.state)
            new_state["step"] = task["on_pass"]
            simulation.state = new_state
            flag_modified(simulation, "state")
            step_changed = sm.public_step(sm.find_step(scenario.steps, task["on_pass"]))

    await scoring.log_action(
        session,
        simulation.id,
        "task_submit",
        {
            "step": step["id"],
            "submission": submission,
            "total": result["total"],
            "passed": result["passed"],
            "feedback": result["feedback"],
        },
        {},
    )
    await session.commit()

    return {
        **result,
        "state": simulation.state,
        "step_changed": step_changed,
        "completed": completed,
    }


async def finish_simulation(
    session: AsyncSession, simulation: Simulation
) -> Simulation:
    _ensure_active(simulation)
    simulation.status = "completed"
    await scoring.log_action(session, simulation.id, "finish", {}, {})
    await session.commit()
    await session.refresh(simulation)
    return simulation
