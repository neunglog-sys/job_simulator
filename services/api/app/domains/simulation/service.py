"""가상 회사 직무 시뮬레이션 — 하루 일과형 + 돌발 퀘스트.

[자유 대화] NPC 페르소나 + 현재 상태값 → LLM 스트리밍 → scoring이 delta 평가
[과제 제출] AI 채점 → 통과 시 다음 스텝 / 미달 시 힌트 3단계(조언 카드)
[돌발 퀘스트] 스텝 전환 시 확률 발동(마지막 전환에서 미발동이면 강제) — 실패해도 진행 비차단
→ 모든 행동 action_logs 적재 → 리포트 재료
"""

import logging
import random
import re
from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.content import game_map
from app.content.kb_map import kb_jobs_for
from app.content.knowledge import search_knowledge
from app.domains.coach import service as coach
from app.domains.scoring import aggregate
from app.domains.scoring import service as scoring
from app.domains.simulation import affinity
from app.domains.simulation import hints
from app.domains.simulation import state_machine as sm
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Message, Npc, NpcPlacement, Scenario, Simulation, User

logger = logging.getLogger(__name__)

MEMORY_TURNS = 20
SCORING_TURNS = 40  # 채점 대화록 상한 — 하루 종일 대화해도 채점 프롬프트가 무한 성장하지 않게
RAG_TOP_K = 3
RAG_MAX_DISTANCE = 0.4  # Gemini 임베딩은 거리대가 좁음(관련 ~0.2, 무관 ~0.28) — eval로 재튜닝 대상
COACH_RAG_TOP_K = 6  # 코치는 가르치는 입장 — NPC(3)보다 넓게 그 직무 전체 그림을 그라운딩


async def _coach_knowledge(
    session: AsyncSession, scenario: Scenario, *query_parts: str
) -> list[str]:
    """코치 카드 그라운딩 — 그 직무 스코프(kb_jobs_for) RAG 청크 내용. 실패·미매핑이면 [] (비차단)."""
    query = " ".join(p for p in query_parts if p).strip()
    if not query:
        return []
    try:
        chunks = await search_knowledge(
            session, query, job_code=kb_jobs_for(scenario.slug),
            top_k=COACH_RAG_TOP_K, max_distance=RAG_MAX_DISTANCE,
        )
    except Exception:  # noqa: BLE001 — 코치 근거 검색 실패가 제출을 막으면 안 됨
        logger.warning("코치 RAG 검색 실패 (scenario=%s) — 근거 없이 카드 생성", scenario.slug)
        return []
    return [c.content for c in chunks]


# NPC 화법 — 현장·기능직 계열(family F03·F04·F07·F14·F15·F18~F24)에 매핑되는 시나리오는 반말,
# 사무·전문직 계열(F01·F02·F05·F06·F08~F13·F16·F17)은 존대. 매핑 안 된 slug은 기본 존대.
_BANMAL_SLUGS = {
    "jm-01", "jm-02", "jm-03", "jm-04", "jm-05",
    "ms-04", "ms-05", "ms-06", "ms-07", "ms-08", "ms-09", "ms-10",
    "yg-01", "yg-02", "yg-05",
    "ys-01", "ys-02", "ys-03", "ys-04", "ys-05",
    "ys-06", "ys-07", "ys-08", "ys-09", "ys-10",
    "gm-01", "sns-01", "wh-01", "cln-01",
}


def register_for(slug: str) -> str:
    """시나리오 slug → NPC 화법('반말'|'존대'). 미매핑은 기본 존대."""
    return "반말" if slug in _BANMAL_SLUGS else "존대"


# NPC 역할 분류 — 화법·톡식 적용 범위 결정용. 고객 우선, 그다음 동료, 나머지는 사수(상사).
_CUST_KW = ("고객", "손님", "환자", "민원", "방문", "투숙", "회원", "수강생", "승객", "보호자",
            "거래처", "협력", "클라이언트", "의뢰인", "이용자", "이용객", "관람", "구매자",
            "바이어", "점주", "입주", "내담")
_PEER_KW = ("동료", "동기", "선배", "후배", "팀원", "파트너")


def npc_kind(role: str, rank: str) -> str:
    """NPC 역할 → '고객' | '동료' | '사수'(기본)."""
    blob = f"{role or ''} {rank or ''}"
    if any(k in blob for k in _CUST_KW):
        return "고객"
    if any(k in blob for k in _PEER_KW):
        return "동료"
    return "사수"


def register_for_npc(slug: str, kind: str) -> str:
    """고객은 시나리오 화법과 무관하게 존대(정중 응대) 기본. 사수·동료는 시나리오 화법."""
    return "존대" if kind == "고객" else register_for(slug)


_HANGUL = re.compile(r"[가-힣]")
_SENTS = re.compile(r"[^.!?…]*[.!?…]+|\S[^.!?…]*$")


def _clean_npc(text: str) -> str:
    """NPC 응답 이물 정리 — `_`·홑따옴표·가장자리 마크업 제거 + 비한글(영어·수식) 문장 제거.

    비한글 문장의 문자 구간만 도려내고 한글 문장은 원문 그대로 이어붙여, 문장부호·따옴표
    간격 왜곡 없이 앞/중간/꼬리 어디의 영어든 제거한다. 전부 비한글이면 원문을 유지한다.
    """
    text = " ".join(text.split())
    text = text.replace("_", "").replace("'", "")
    text = text.strip(' "`*<>').strip()
    kept = "".join(m.group() for m in _SENTS.finditer(text) if _HANGUL.search(m.group()))
    kept = " ".join(kept.split()).strip()
    kept = re.sub(r"^(?:[A-Za-z]+[ ,]*)+", "", kept).strip()  # 한글 앞 영어 인사말(Excuse me 등) 제거
    return kept or text


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


async def npc_map(session: AsyncSession, scenario_id: int) -> dict[str, dict]:
    """npc_id → 조립용 필드 dict (고유정보 npcs + 배치정보 placements 조인).

    이름은 npc_id로만 참조하므로, 표시·프롬프트·대화록에서 npc_id를 사람이 읽는 이름으로
    바꿀 때 이 맵을 쓴다.
    """
    rows = (
        await session.execute(
            select(Npc, NpcPlacement)
            .join(NpcPlacement, NpcPlacement.npc_id == Npc.npc_id)
            .where(NpcPlacement.scenario_id == scenario_id)
            # 순서 고정 필수 — spawn 자리 배정이 순서 의존이라, 없으면 요청마다 NPC 위치가 뒤바뀜
            .order_by(NpcPlacement.id)
        )
    ).all()
    return {
        npc.npc_id: {
            "npc_id": npc.npc_id, "name": npc.name, "role": pl.role, "rank": pl.rank,
            "personality": npc.personality or [], "likes": npc.likes or [],
            "dislikes": npc.dislikes or [], "speech_habits": npc.speech_habits or [],
            "responsibilities": pl.responsibilities or [],
            # 맵 자리 배정용 — YAML의 appearance.location (데이터가 있으면 추론보다 우선)
            "location": (pl.appearance or {}).get("location"),
        }
        for npc, pl in rows
    }


def _public_npcs(
    roster: dict[str, dict], slots: tuple[str, ...] = game_map.NPC_SLOTS
) -> list[dict]:
    """클라이언트 표시용 NPC 목록 — 프롬프트 재료(성격·선호 등)는 빼고 표시 필드만.

    spawn = 맵 geometry의 NPC 자리 이름(teamjang|sasu|bujang). 프론트는 geometry.spawns에서
    같은 id의 좌표를 찾아 그 위치에 NPC를 그린다. slots는 이 맵에 실제로 있는 자리만.
    """
    assigned = game_map.assign_spawn_slots(list(roster.values()), slots)
    return [
        {
            "npc_id": v["npc_id"], "name": v["name"], "role": v["role"], "rank": v["rank"],
            "spawn": assigned.get(v["npc_id"]),
        }
        for v in roster.values()
    ]


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


async def to_out(session: AsyncSession, simulation: Simulation, scenario: Scenario) -> dict:
    step = _resolve_step(scenario, simulation.state)
    roster = await npc_map(session, scenario.id)
    # 게임 맵 — {id, background(정적 URL), geometry(walkable·collision·spawns)}.
    # null이면 맵 미배정/좌표 없음 → 프론트는 기존 module 배경 방식으로 폴백.
    map_info = game_map.map_info_for(scenario.slug)
    # NPC 자리는 이 맵에 실제로 있는 것만 배정 (일부 맵은 자리가 2개뿐)
    slots = game_map.npc_slots_in(map_info["geometry"]) if map_info else game_map.NPC_SLOTS
    return {
        "id": simulation.id,
        "scenario_slug": scenario.slug,
        "scenario_title": scenario.title,
        "module": scenario.module,  # 프론트 배경 8세트 선택용
        "status": simulation.status,
        "state": public_state(simulation.state),
        "step": sm.public_step(step),
        "npcs": _public_npcs(roster, slots),  # 시나리오 NPC 표시정보 (step.npcs는 npc_id 목록)
        "map": map_info,
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


def _speaker(m: Message, roster: dict[str, dict]) -> str:
    """대화록·문맥에 표시할 화자 이름 — npc_id를 사람이 읽는 이름으로."""
    if m.role == "user":
        return "사용자"
    info = roster.get(m.npc_id or "")
    return info["name"] if info else "NPC"


# AI 코치 실시간 TIP 발동 조건 — 신입이 정답을 요구하거나 답답해할 때, 또는 사수가 거부/무뚝뚝하게 반응할 때
_TIP_USER = re.compile(r"정답|답\s*(을|좀|이|뭐|알려|찍)|그냥\s*(알려|해|답)|알려\s*주|찍어|짜증|몰라|모르겠|대충|귀찮|하기\s*싫")
_TIP_NPC = re.compile(r"왜\s*(나|저)한테|직접\s*(확인|알아|해)|본인이\s*(직접|알아|확인)|알아서\s*(해|찾)")


def _should_coach_tip(user_text: str, npc_reply: str) -> bool:
    return bool(_TIP_USER.search(user_text) or _TIP_NPC.search(npc_reply))


async def stream_npc_chat(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    npc_id: str,
    user_text: str,
) -> AsyncIterator[tuple[str, object]]:
    """NPC 대화 처리 — ("token", str) 조각들 후 ("final", dict) 하나를 yield. npc_id로 지목."""
    _ensure_active(simulation)
    step = _resolve_step(scenario, simulation.state)
    allowed = set(step.get("npcs", []))
    quest = simulation.state.get("quest") or {}
    if quest.get("status") == "active" and scenario.sudden_quest:
        allowed.add(scenario.sudden_quest.get("npc"))  # 퀘스트 NPC와도 대화 가능
    if npc_id not in allowed:
        raise HTTPException(status_code=400, detail=f"현재 스텝에 없는 NPC: {npc_id}")

    roster = await npc_map(session, scenario.id)
    persona = roster.get(npc_id)
    if persona is None:
        raise HTTPException(status_code=404, detail=f"NPC 없음: {npc_id}")

    # 사용자 발화 저장
    session.add(Message(simulation_id=simulation.id, role="user", content=user_text))
    await session.commit()

    # 호감도: 이번 발화의 태도로 이 NPC 호감도만 가감(룰 기반, 즉시 반영). NPC별 독립값이라
    # 시나리오 전역 상태값(trust 등)과 별개. state에 써두면 아래 NPC 응답 저장 커밋에 함께 영속된다.
    aff_delta = affinity.delta_for(user_text)
    aff_state, aff_value = affinity.bumped(simulation.state, npc_id, aff_delta)
    simulation.state = aff_state
    flag_modified(simulation, "state")

    # 최근 대화 + NPC 시스템 프롬프트 (화자는 npc_id → 이름으로 표시)
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
            content=m.content if m.role == "user" else f"[{_speaker(m, roster)}] {m.content}",
        )
        for m in history
    ]
    # RAG: 발화 관련 직무 지식을 NPC 프롬프트에 주입 (Gemini 임베딩, doc_chunks).
    # 스코프 = 시나리오 slug → KB v5 직무군 J코드들(kb_map). KB 지식은 J0xx로 적재돼 있고
    # 시나리오는 ys-01 등이라 이 변환이 없으면 검색이 0건이 된다. 매핑 없으면 [] → 주입 없음(안전).
    try:
        chunks = await search_knowledge(
            session, user_text, job_code=kb_jobs_for(scenario.slug),
            top_k=RAG_TOP_K, max_distance=RAG_MAX_DISTANCE,
        )
    except Exception:  # noqa: BLE001 — RAG 검색 실패가 대화를 끊지 않게 (지식 없이 진행)
        logger.warning("NPC RAG 검색 실패 (simulation=%d) — 지식 없이 대화 진행", simulation.id)
        chunks = []
    knowledge = (
        "\n\n".join(f"[{c.source}]\n{c.content}" for c in chunks) if chunks else None
    )
    # 프롬프트는 코드 템플릿이 구조화 필드를 조립 (system_prompt 통짜 저장 안 함)
    kind = npc_kind(persona["role"], persona["rank"])  # 사수/동료/고객 → 화법·톡식 범위
    system = render_prompt(
        "npc/system.md",
        scenario_title=scenario.title,
        register=register_for_npc(scenario.slug, kind),
        npc_kind=kind,
        mission=step["mission"],
        name=persona["name"], role=persona["role"], rank=persona["rank"],
        personality=persona["personality"], likes=persona["likes"],
        dislikes=persona["dislikes"], speech_habits=persona["speech_habits"],
        responsibilities=persona["responsibilities"],
        state=simulation.state,
        affinity=aff_value, affinity_band=affinity.band(aff_value),
        knowledge=knowledge,
    )

    full: list[str] = []
    # NPC는 사실 그라운딩과 역할 일관성을 우선하므로 창의성을 낮게 유지한다.
    async for chunk in get_llm().chat_stream(context, system=system, temperature=0.3):
        full.append(chunk)
        yield ("token", chunk)
    npc_reply = _clean_npc("".join(full))

    # 사용자가 이미 스트림으로 본 답변이므로 먼저 확정 저장한다 — 이후 평가가 실패해도
    # 대화록(채점·NPC 기억의 근거)이 사용자가 본 것과 어긋나지 않게.
    session.add(
        Message(simulation_id=simulation.id, role="npc", npc_id=npc_id, content=npc_reply)
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
            {"npc": npc_id, "user_text": user_text, "reason": reason}, deltas,
        )
        await session.commit()
    except Exception:  # noqa: BLE001 — 평가 실패가 확정된 대화를 되돌리거나 소켓을 죽이면 안 됨
        await session.rollback()
        logger.exception("발언 영향 평가 실패 (simulation=%d) — 대화 유지, 전이 생략", simulation.id)

    # AI 코치 실시간 TIP — 사수가 정답요구를 거부하거나 신입이 답답해할 때 문장형 조언
    # (항목별 힌트카드는 과제 오답 제출 때, 이 TIP은 대화 중에. 실패해도 대화 비차단)
    if _should_coach_tip(user_text, npc_reply):
        tip = await coach.generate_tip(
            mission=step["mission"],
            criteria=(step.get("task") or {}).get("criteria", []),
            user_text=user_text,
            npc_reply=npc_reply,
            # NPC와 동일 스코프로 이미 검색한 청크 재사용 (추가 임베딩 호출 없음)
            knowledge=("\n\n".join(c.content for c in chunks) if chunks else None),
        )
        if tip:
            yield ("coach_tip", {"text": tip})

    yield (
        "final",
        {
            "npc": npc_id,
            "name": persona["name"],
            "content": npc_reply,
            "delta": deltas,
            # NPC별 호감도 — 프론트 친밀도 게이지용 (value 0~100, 이번 턴 변화량, 밴드)
            "affinity": {"value": aff_value, "delta": aff_delta, "band": affinity.band(aff_value)},
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


async def _transcript(session: AsyncSession, simulation: Simulation, scenario: Scenario) -> str:
    """대화에서 실제로 정보를 수집했는지 채점에 반영하기 위한 대화록 (npc_id→이름 표시)."""
    roster = await npc_map(session, scenario.id)
    history = list(
        (
            await session.execute(
                select(Message)
                .where(Message.simulation_id == simulation.id)
                .order_by(Message.id)
            )
        ).scalars()
    )
    return "\n".join(
        f"{_speaker(m, roster)}: {m.content}" for m in history[-SCORING_TURNS:]
    )


async def _grade(
    session: AsyncSession, simulation: Simulation, scenario: Scenario,
    mission: str, task: dict, submission: str | list,
) -> dict:
    """채점 라우팅 — 선택·배열형은 룰 채점(결정적), 서술형은 대화록 포함 LLM 채점."""
    if task.get("kind") in scoring.RULE_KINDS:
        return scoring.grade_structured(task, submission)
    transcript = await _transcript(session, simulation, scenario)
    try:
        return await scoring.evaluate_task(mission, task, transcript, str(submission))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — LLM 채점 실패를 게임차단(WS 1011) 대신 재시도 가능 오류로
        logger.warning("과제 채점 실패 (simulation=%d): %s", simulation.id, e)
        raise HTTPException(
            status_code=503, detail="채점을 완료하지 못했어요. 잠시 후 다시 제출해 주세요.",
        ) from e


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


def _public_quest(quest_def: dict, npc_name: str | None = None) -> dict:
    """클라이언트용 퀘스트 정보 — 정답(hints·answer)은 숨김. npc는 npc_id + 표시 이름."""
    return {
        "npc": quest_def.get("npc"),  # npc_id
        "npc_name": npc_name,
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

    result = await _grade(session, simulation, scenario, step["mission"], task, submission)

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
                q_roster = await npc_map(session, scenario.id)
                q_name = (q_roster.get(scenario.sudden_quest.get("npc")) or {}).get("name")
                quest_fired = _public_quest(scenario.sudden_quest, q_name)
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
            knowledge=await _coach_knowledge(session, scenario, step["mission"], task.get("prompt", "")),
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
        session, simulation, scenario, qtask.get("mission") or qtask["prompt"], qtask, submission
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
            knowledge=await _coach_knowledge(
                session, scenario, qtask.get("mission") or qtask.get("prompt", "")
            ),
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
