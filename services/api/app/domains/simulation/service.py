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
from app.content import materials
from app.content import minigame
from app.content.loader import yaml_scenario_slugs
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
from app.models import Consultation, Message, Npc, NpcPlacement, Scenario, Simulation, User

logger = logging.getLogger(__name__)

MEMORY_TURNS = 20
SCORING_TURNS = 40  # 채점 대화록 상한 — 하루 종일 대화해도 채점 프롬프트가 무한 성장하지 않게
RAG_TOP_K = 3
RAG_MAX_DISTANCE = 0.35  # 실측(0722): 정답매칭 ~0.22~0.33 · 오프토픽 ~0.37~0.46 — 그 사이로 낮춤.
# 여긴 job_code 스코프(kb_jobs_for)라 타직무 교차오염은 해당 없음(consultation과 차이).
COACH_RAG_TOP_K = 6  # 코치는 가르치는 입장 — NPC(3)보다 넓게 그 직무 전체 그림을 그라운딩


def _player_name(state: dict) -> str:
    return str(state.get("player_name") or "").strip()


def _player_address(state: dict) -> str:
    """NPC가 사용할 신입 호칭. 역할형 이름도 어색한 '관리자 씨' 대신 '관리자님'으로."""
    name = _player_name(state)
    if not name:
        return "담당자님"
    if name.endswith(("님", "씨")):
        return name
    return f"{name}님"


def _personalize_text(scenario: Scenario, state: dict, text: str | None) -> str:
    """SNS-01 원본의 고정 가명('지수 씨')을 현재 로그인 사용자 호칭으로 치환."""
    value = str(text or "")
    if scenario.slug == "sns-01":
        value = re.sub(r"지수\s*씨", _player_address(state), value)
    return value


def _pick_material_sets(slug: str, seed: int) -> dict[str, str]:
    """시뮬레이션 생성 시 스텝별 제공자료 세트를 하나씩 골라 둔다 — {step_id: set_id}.

    state에 박아 두므로 새로고침·재개해도 같은 자료를 본다. 플레이마다 다른 세트가 나와
    (세트별 차액 원인이 다르다) 정답을 외워서 풀 수 없다.
    """
    picked: dict[str, str] = {}
    for step_id in materials.steps_with_materials(slug):
        sets = materials.material_sets_for(slug, step_id)
        if sets:
            chosen = sets[seed % len(sets)]
            picked[step_id] = str(chosen.get("id") or "")
    return picked


def _material_set_for(scenario: Scenario, state: dict, step_id: str) -> dict | None:
    """이 시뮬레이션이 볼 자료 세트 — state에 박아둔 id로 찾는다(없으면 첫 세트)."""
    sets = materials.material_sets_for(scenario.slug, step_id)
    if not sets:
        return None
    wanted = (state.get("material_sets") or {}).get(step_id)
    for candidate in sets:
        if str(candidate.get("id") or "") == wanted:
            return candidate
    return sets[0]


def _task_with_material_criteria(
    scenario: Scenario, state: dict, step: dict, task: dict
) -> dict:
    """이번 세트의 차액 원인을 채점 기준에 추가한 task 사본 — 세트마다 정답이 다르기 때문."""
    chosen = _material_set_for(scenario, state, step["id"])
    cause = str((chosen or {}).get("cause") or "").strip()
    if not cause:
        return task
    merged = dict(task)
    merged["criteria"] = [*(task.get("criteria") or []), f"제공자료가 가리키는 실제 원인({cause})을 찾아냈는가"]
    return merged


def _public_step(scenario: Scenario, state: dict, step: dict) -> dict:
    out = sm.public_step(step)
    out["mission"] = _personalize_text(scenario, state, out.get("mission"))
    # 제공자료 본문 — guide는 이름만 나열하므로, 실제로 대조할 수 있게 문서를 함께 내려준다.
    chosen = _material_set_for(scenario, state, step["id"])
    out["materials"] = materials.public_documents(chosen) if chosen else []
    return out


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
            "바이어", "점주", "입주", "내담", "컨슈머", "소비자")
_PEER_KW = ("동료", "동기", "선배", "후배", "팀원", "파트너")


def npc_kind(role: str, rank: str) -> str:
    """NPC 역할 → '고객' | '동료' | '사수' | '상급자'(기본).

    사수는 직책이 아니라 신입의 '직속 지도 담당'이므로 role에 '사수'가 명시된 NPC만 사수로 본다.
    고객·동료·사수 어디에도 해당하지 않으면 상급자(점장·팀장 등 더 높은 상관)로 분류한다.
    상급자는 화법·프롬프트에서 사수와 동일하게 취급한다(지시·질문 응대 방식이 같음).
    """
    blob = f"{role or ''} {rank or ''}"
    if any(k in blob for k in _CUST_KW):
        return "고객"
    if any(k in blob for k in _PEER_KW):
        return "동료"
    if "사수" in blob:
        return "사수"
    return "상급자"


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
    # 문맥이 NPC 발화를 "[이름] ..."로 넣어 모델이 그 화자 태그를 흉내내는 경우가 있다 — 접두 제거.
    text = re.sub(r"^\s*\[[^\]]{1,20}\]\s*", "", text).strip()
    kept = "".join(m.group() for m in _SENTS.finditer(text) if _HANGUL.search(m.group()))
    kept = " ".join(kept.split()).strip()
    kept = re.sub(r"^(?:[A-Za-z]+[ ,]*)+", "", kept).strip()  # 한글 앞 영어 인사말(Excuse me 등) 제거
    return kept or text


async def create_simulation(
    session: AsyncSession, user: User, scenario_slug: str,
    consultation_id: int | None = None,
) -> tuple[Simulation, Scenario]:
    # _disabled로 뺀 시나리오는 DB에 남아있어도 새 플레이를 못 열게 막는다
    # (목록에서만 숨기면 slug 직접 지정으로 우회 가능하므로 진입점도 차단).
    if scenario_slug not in yaml_scenario_slugs():
        raise HTTPException(status_code=404, detail=f"시나리오 없음: {scenario_slug}")
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
        "coach_streak": 0,  # 진전(제출) 없이 이어진 미션 대화 턴 수 → 정체 감지용
        "player_name": user.name,
        # 스텝별 제공자료 세트를 지금 골라 박아 둔다 — 새로고침·재개해도 같은 자료를 보고,
        # 플레이마다 다른 세트(=다른 차액 원인)가 나와 정답을 외워서 풀 수 없다.
        "material_sets": _pick_material_sets(scenario_slug, random.randrange(1_000_000)),
    }
    # 상담에서 진입했으면 그 상담 id를 박아둔다 — 재개(이어하기)로 URL 파라미터가 유실돼도
    # 완주 리포트가 상담을 붙일 수 있게. 남의 상담 id는 무시(도용 방지·게임은 계속 진행).
    linked_consultation_id = None
    if consultation_id is not None:
        consultation = await session.get(Consultation, consultation_id)
        if consultation is not None and consultation.user_id == user.id:
            linked_consultation_id = consultation_id
    simulation = Simulation(
        user_id=user.id,
        scenario_id=scenario.id,
        consultation_id=linked_consultation_id,
        state=state,
    )
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
    # 기존 진행 세션도 프로필의 현재 표시 이름을 즉시 따라간다.
    if simulation.state.get("player_name") != user.name:
        state = dict(simulation.state)
        state["player_name"] = user.name
        simulation.state = state
        flag_modified(simulation, "state")
        await session.commit()
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
            # 등장 조건 — 비어있지 않으면 아직 미충족 상태(예: quest_started)라 온보딩 시점엔 항상 미달성
            "conditions": (pl.appearance or {}).get("conditions") or [],
        }
        for npc, pl in rows
    }


def _public_npcs(
    roster: dict[str, dict], slots: tuple[str, ...] = game_map.NPC_SLOTS
) -> list[dict]:
    """클라이언트 표시용 NPC 목록 — 프롬프트 재료(성격·선호 등)는 빼고 표시 필드만.

    spawn = 맵 geometry의 NPC 자리 이름(teamjang|sasu|bujang|npc4|npc5). 프론트는 geometry.spawns에서
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
        "consultation_id": simulation.consultation_id,  # 재개 시 리포트 연동 복원용 (없으면 null)
        "scenario_slug": scenario.slug,
        "scenario_title": scenario.title,
        "module": scenario.module,  # 프론트 배경 8세트 선택용
        "status": simulation.status,
        "state": public_state(simulation.state),
        "step": _public_step(scenario, simulation.state, step),
        # 본편 미션 id 순서 (진행률 계산용) — 돌발 퀘스트는 steps에 없어 자연히 제외됨
        "step_ids": [s["id"] for s in scenario.steps],
        "npcs": _public_npcs(roster, slots),  # 시나리오 NPC 표시정보 (step.npcs는 npc_id 목록)
        "map": map_info,
        # 4단계 미니게임 정의 — null이면 프론트는 '준비 중' 빈 창으로 폴백
        "minigame": minigame.minigame_for(scenario.slug),  # 하위호환(첫 게임)
        # 직무당 게임 2~3개 — 목록 순서대로, step이 있으면 그 스텝에서 띄운다
        "minigames": minigame.minigames_for(scenario.slug),
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
    """delta(상태값 변화)만 적용한다 → (새 상태, None).

    스텝 전진은 오직 과제 통과(task.on_pass)로만 일어난다 (게임 설계 확정 2026-07-20).
    상태값 임계 전이(transitions/when)는 쓰지 않기로 해 어떤 시나리오에도 없으므로,
    대화·선택의 delta는 상태값만 누적하고 스텝은 절대 바꾸지 않는다(항상 changed_step=None).
    """
    new_state = sm.apply_deltas(simulation.state, deltas)
    simulation.state = new_state
    flag_modified(simulation, "state")  # JSONB 전체 교체 감지
    await session.flush()
    return new_state, None


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


# 정체 감지 — 키워드 트리거 없이도, 미션에 실질적 영향이 없는 대화(아래 두 신호)만 이어지면
# 코치가 먼저 끼어든다. 매 턴 반응하면 참견처럼 느껴지고 너무 뜸하면 방치처럼 느껴져
# 3턴으로 절충 (팀 조정 가능).
STAGNANT_TURNS = 3
REPEAT_SIMILARITY = 0.6  # 이 이상이면 "같은 말 되풀이"로 간주 (문자 2-gram 자카드)


def _text_similarity(a: str, b: str) -> float:
    """공백 제거 후 문자 2-gram 자카드 유사도 — 형태소 분석 없이 반복 발화를 싸게 감지."""
    def bigrams(s: str) -> set[str]:
        s = re.sub(r"\s+", "", s)
        return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else {s}

    A, B = bigrams(a), bigrams(b)
    return len(A & B) / len(A | B) if A and B else 0.0


async def stream_npc_chat(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    npc_id: str,
    user_text: str,
    *,
    chat_mode: str = "work",
) -> AsyncIterator[tuple[str, object]]:
    """NPC 대화 처리 — ("token", str) 조각들 후 ("final", dict) 하나를 yield. npc_id로 지목."""
    _ensure_active(simulation)
    step = _resolve_step(scenario, simulation.state)
    # 업무 설명 대화는 SNS-01의 실제 브리핑이 있는 단계에서만 허용한다.
    # 클라이언트가 임의 문맥을 보내지 않고 서버의 시나리오 원문을 사용해 프롬프트 주입을 막는다.
    process_learning = (
        chat_mode == "process_learning"
        and scenario.slug == "sns-01"
        and bool(step.get("briefing"))
    )
    conversation_mode = "process_learning" if process_learning else "work"
    learning_briefing = list(step.get("briefing") or []) if process_learning else []
    mission_npcs = set(step.get("npcs", []))
    # 활성 퀘스트 중에는 채점 기준을 퀘스트 과제로 바꾼다 — 안 그러면 퀘스트 NPC와의 대화가
    # 엉뚱한 본편 스텝 루브릭으로 평가돼 무관한 상태값(trust 등)이 오르내린다.
    quest = simulation.state.get("quest") or {}
    quest_active = quest.get("status") == "active" and bool(scenario.sudden_quest)
    if quest_active:
        quest_npc = scenario.sudden_quest.get("npc")
        mission_npcs = {quest_npc}  # 퀘스트 중엔 퀘스트 NPC만 채점 대상
        grading_mission = (scenario.sudden_quest.get("task") or {}).get("prompt", "")
    else:
        grading_mission = _personalize_text(scenario, simulation.state, step["mission"])

    roster = await npc_map(session, scenario.id)
    persona = roster.get(npc_id)
    if persona is None:
        # npc는 npc_id여야 한다(이름 아님). 프론트가 이름을 보내면 여기로 온다.
        raise HTTPException(status_code=404, detail=f"NPC 없음: {npc_id} (npc_id로 지목하세요)")

    # 자유 대화: 이 시나리오 로스터의 누구와도 말은 걸 수 있다(맵에서 NPC 클릭 → 잡담).
    # 단 미션 채점·상태 전이·코치 TIP은 현재 스텝(또는 활성 퀘스트) NPC일 때만 —
    # 엉뚱한 NPC와의 잡담이 미션을 진행시키거나 점수를 주면 안 된다.
    # 호감도는 NPC별 사회적 값이라 상대가 누구든 즉시 반영한다.
    # 설명을 이해하기 위한 질문은 과제 제출이나 역량 평가가 아니다.
    mission_active = npc_id in mission_npcs and not process_learning

    # 호감도: 이번 발화의 태도로 이 NPC 호감도만 가감(룰 기반, 즉시 반영). NPC별 독립값이라
    # 시나리오 전역 상태값(trust 등)과 별개.
    # 첫 대면 여부를 먼저 판정한다 — 인사 예절 페널티가 호감도 델타에 반영돼야 하므로.
    # 만난 동료를 state에 기록해 둔다(1단계 진행도: 모든 동료와 인사해야 업무가 열림).
    met = list(simulation.state.get("met_npcs") or [])
    first_meeting = npc_id not in met
    greeted = affinity.is_greeting(user_text)

    aff_delta = affinity.delta_for(user_text)
    # 첫 대면인데 인사 없이 용건부터 꺼내면 예의 없음 → 추가 감점(톡식 반응과 짝을 이룸).
    if first_meeting and not greeted:
        aff_delta += affinity.FIRST_MEETING_NO_GREETING_PENALTY
    aff_state, aff_value = affinity.bumped(simulation.state, npc_id, aff_delta)

    if first_meeting:
        met.append(npc_id)
        aff_state = {**aff_state, "met_npcs": met}
    simulation.state = aff_state
    flag_modified(simulation, "state")

    # 사용자 발화 + 호감도·met_npcs를 한 번에 커밋한다. 이 둘을 NPC 응답 커밋(스트림 종료 후)까지
    # 미루면, 토큰 스트리밍 중 클라이언트가 끊길 때(탭 닫기 등) 발화만 남고 호감도·met_npcs가
    # 롤백돼 재접속 시 그 NPC가 자기소개를 반복하고 호감도가 유실된다.
    session.add(Message(simulation_id=simulation.id, role="user", content=user_text))
    await session.commit()

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
    # 손님에게는 직원 미션(현재 스텝 과제)을 주입하지 않는다 — 안 그러면 손님이 그 업무의
    # '담당 업무/현재 업무'인 줄 알고 신입에게 업무를 지시하는 직원처럼 군다(손님≠직원).
    # 대신 '손님으로서의 상황'을 줘서 손님답게(용건·문의·요청·불만) 말하게 한다.
    # 단, 손님이 지금 미션 NPC일 때(예: 블랙컨슈머 돌발 퀘스트)는 그 미션이 곧 손님 자신의
    # 상황이므로 grading_mission을 그대로 준다 — 안 그러면 퀘스트 상황을 잃는다.
    if kind == "고객" and npc_id not in mission_npcs:
        persona_mission = (
            "당신은 직원이 아니라 이 서비스·브랜드를 이용하는 고객(이용자)입니다. 신입 직원에게 "
            "업무를 지시하지 말고, 고객으로서 자신의 용건(문의·요청·불만·반응)만 현실적으로 말합니다."
        )
    else:
        persona_mission = grading_mission
    system = render_prompt(
        "npc/system.md",
        scenario_title=scenario.title,
        player_name=_player_name(simulation.state),
        player_address=_player_address(simulation.state),
        conversation_mode=conversation_mode,
        learning_briefing=learning_briefing,
        register=register_for_npc(scenario.slug, kind),
        npc_kind=kind,
        mission=persona_mission,
        name=persona["name"], role=persona["role"], rank=persona["rank"],
        personality=persona["personality"], likes=persona["likes"],
        dislikes=persona["dislikes"], speech_habits=persona["speech_habits"],
        responsibilities=persona["responsibilities"],
        state=simulation.state,
        affinity=aff_value, affinity_band=affinity.band(aff_value),
        knowledge=knowledge,
        greeted=greeted,  # 첫 대면 무인사 → 톡식 분기(system.md). work 단계에선 무시됨.
        # 첫 대면은 소개하는 자리 — 짧은 메신저 말투·업무 복귀 규칙을 완화한다.
        #   투어 중(tour_done 전) = 사수가 방금 소개했으니 인사만 짧게 받는다(자기소개 중복 방지)
        #   투어 밖에서 처음 만남 = 스스로 소개한다
        #   그 뒤부터 = 평소 업무 대화
        phase=(
            "process_learning"
            if process_learning
            else (
                ("tour_greeting" if not simulation.state.get("tour_done") else "orientation")
                if first_meeting
                else "work"
            )
        ),
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
    if mission_active:
        try:
            deltas, reason = await scoring.evaluate_chat(grading_mission, user_text, npc_reply)
            new_state, changed_step = await _update_state(session, simulation, scenario, deltas)
            await scoring.log_action(
                session, simulation.id, "chat",
                {"npc": npc_id, "user_text": user_text, "reason": reason}, deltas,
            )
            await session.commit()
        except Exception:  # noqa: BLE001 — 평가 실패가 확정된 대화를 되돌리거나 소켓을 죽이면 안 됨
            await session.rollback()
            logger.exception("발언 영향 평가 실패 (simulation=%d) — 대화 유지, 전이 생략", simulation.id)

    # AI 코치 실시간 TIP — ①정답요구/짜증(키워드) ②미션에 실질적 영향 없는 대화가 STAGNANT_TURNS턴
    # 이어짐(정체) 중 하나면 개입. ②는 두 신호 중 하나로 판정 — 턴수를 맹목적으로 세지 않는다:
    #   - deltas 전부 0: 방금 evaluate_chat이 "이 발화는 미션에 영향 없음"이라 판정한 것 그대로 재사용
    #     (+든 -든 값이 붙으면 사수·업무와 관련된 유의미한 발화였다는 뜻이라 리셋)
    #   - is_repeat: 직전 발화와 문자 유사도가 높음 → 같은 말을 표현만 바꿔 되풀이(제자리걸음)
    # (항목별 힌트카드는 과제 오답 제출 때, 이 TIP은 대화 중에. 실패해도 대화 비차단)
    prior_user_msgs = [m.content for m in history[:-1] if m.role == "user"]
    is_repeat = bool(prior_user_msgs) and _text_similarity(user_text, prior_user_msgs[-1]) >= REPEAT_SIMILARITY

    tip_trigger = None
    if mission_active:
        if _should_coach_tip(user_text, npc_reply):
            tip_trigger = "keyword"
            new_state["coach_streak"] = 0
        elif not is_repeat and any(deltas.values()):
            new_state["coach_streak"] = 0  # 유의미한 발화 — 정체 아님
        else:
            streak = int(new_state.get("coach_streak", 0)) + 1
            if streak >= STAGNANT_TURNS:
                tip_trigger = "stagnant"
                streak = 0
            new_state["coach_streak"] = streak
        simulation.state = new_state
        flag_modified(simulation, "state")
        await session.commit()

    if tip_trigger:
        tip = await coach.generate_tip(
            mission=step["mission"],
            criteria=(step.get("task") or {}).get("criteria", []),
            user_text=user_text,
            npc_reply=npc_reply,
            # NPC와 동일 스코프로 이미 검색한 청크 재사용 (추가 임베딩 호출 없음)
            knowledge=("\n\n".join(c.content for c in chunks) if chunks else None),
            trigger=tip_trigger,
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
                _public_step(scenario, new_state, sm.find_step(scenario.steps, changed_step))
                if changed_step
                else None
            ),
        },
    )


async def _persona_line(
    simulation: Simulation, scenario: Scenario, step: dict, persona: dict,
    user_prompt: str, *, temperature: float = 0.5,
) -> str:
    """해당 NPC 페르소나 시스템 프롬프트로 짧은 대사 1개 생성 (인사·격려 공용)."""
    kind = npc_kind(persona["role"], persona["rank"])
    system = render_prompt(
        "npc/system.md",
        scenario_title=scenario.title,
        player_name=_player_name(simulation.state),
        player_address=_player_address(simulation.state),
        register=register_for_npc(scenario.slug, kind),
        npc_kind=kind,
        mission=_personalize_text(scenario, simulation.state, step["mission"]),
        name=persona["name"], role=persona["role"], rank=persona["rank"],
        personality=persona["personality"], likes=persona["likes"],
        dislikes=persona["dislikes"], speech_habits=persona["speech_habits"],
        responsibilities=persona["responsibilities"],
        state=simulation.state,
        affinity=50, affinity_band=affinity.band(50),
        knowledge=None,
        phase="work",  # 인사·격려 대사는 평소 말투(짧게)
    )
    return _clean_npc(
        await get_llm().chat([ChatMessage(role="user", content=user_prompt)], system=system, temperature=temperature)
    )


async def npc_greeting(
    session: AsyncSession, simulation: Simulation, scenario: Scenario
) -> dict:
    """현재 스텝 담당 NPC의 실시간 인사 — 플레이어가 다가왔을 때 짧게 인사하며 업무를 건넨다.

    LLM 실패 시 시나리오 미션의 NPC 대사(첫 문단)로 폴백. 채점·상태 변경 없음(부작용 없음).
    """
    step = _resolve_step(scenario, simulation.state)
    npc_id = (step.get("npcs") or [None])[0]
    fallback = _personalize_text(
        scenario, simulation.state, step.get("mission")
    ).split("\n\n")[0].strip()
    roster = await npc_map(session, scenario.id)
    persona = roster.get(npc_id or "")
    if persona is None:
        return {"npc": npc_id, "name": "", "text": fallback}

    prompt = (
        "신입 직원이 방금 당신에게 다가왔습니다. 짧게 인사하고, 오늘 맡길 업무를 "
        "자연스럽게 건네세요. 2~3문장, 정답은 알려주지 말 것."
    )
    try:
        text = await _persona_line(simulation, scenario, step, persona, prompt, temperature=0.5)
    except Exception:  # noqa: BLE001 — 인사 생성 실패가 게임을 막지 않게 폴백
        logger.warning("NPC 인사 생성 실패 (simulation=%d) — 시나리오 대사로 폴백", simulation.id)
        text = ""
    return {"npc": npc_id, "name": persona["name"], "text": text or fallback}


_TOUR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "opening": {"type": "string", "minLength": 1, "maxLength": 200},
        "stops": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "npc": {"type": "string", "minLength": 1},
                    "line": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["npc", "line"],
            },
        },
        "closing": {"type": "string", "minLength": 1, "maxLength": 260},
    },
    "required": ["opening", "stops", "closing"],
}


async def onboarding_tour(
    session: AsyncSession, simulation: Simulation, scenario: Scenario
) -> dict:
    """1단계 — 사수가 신입을 데리고 다니며 팀원을 한 명씩 소개하는 투어 대사.

    사수(현재 스텝 담당 NPC)가 각 동료 앞에서 "이 사람은 누구고 무슨 일을 한다"를 소개하고,
    마지막에 오늘 업무가 어떻게 흘러가는지 큰 흐름을 짚는다. 개별 과제의 정답·절차 상세는
    각 업무 브리핑(step.briefing)이 담당하므로 여기서는 말하지 않는다.

    LLM 실패 시 페르소나(역할·담당)로 만든 문구로 폴백 — 투어가 게임을 막지 않게.
    """
    step = _resolve_step(scenario, simulation.state)
    guide_id = (step.get("npcs") or [None])[0]
    roster = await npc_map(session, scenario.id)
    guide = roster.get(guide_id or "")
    # conditions가 있는 NPC(예: quest_started)는 온보딩 시점엔 조건이 충족될 수 없으므로
    # 아직 등장할 차례가 아닌 손님·퀘스트 캐릭터 — 팀원 소개 투어에서 제외한다.
    # 팀원 소개 투어에는 '직원'만 넣는다 — 손님(고객)은 동료가 아니므로 사수가 소개하지 않는다.
    # (conditions 있는 NPC는 아직 등장 차례가 아니라 별도로 제외)
    others = [
        v
        for k, v in roster.items()
        if k != guide_id
        and not v.get("conditions")
        and npc_kind(v["role"], v["rank"]) != "고객"
    ]
    if guide is None or not others:
        return {"guide": None, "stops": [], "closing": ""}

    def fallback() -> dict:
        return {
            "opening": f"반가워. 나는 {guide['name']}, {guide['role']} 맡고 있어. 오늘 팀 한 바퀴 소개해 줄게.",
            "stops": [
                {
                    "npc": o["npc_id"],
                    "line": f"이쪽은 {o['name']}. {o['role']}"
                    + (f" 맡고 있고, {o['responsibilities'][0]} 쪽을 봐." if o.get("responsibilities") else " 맡고 있어."),
                }
                for o in others
            ],
            "closing": f"오늘은 {step['title']}부터 시작할 거야. 준비되면 나한테 와.",
        }

    listing = "\n".join(
        f"- {o['npc_id']} / {o['name']} / 역할: {o['role']} / 직급: {o['rank'] or '-'}"
        f" / 담당: {', '.join(o.get('responsibilities') or []) or '-'}"
        for o in others
    )
    kind = npc_kind(guide["role"], guide["rank"])
    system = render_prompt(
        "npc/system.md",
        scenario_title=scenario.title,
        player_name=_player_name(simulation.state),
        player_address=_player_address(simulation.state),
        register=register_for_npc(scenario.slug, kind),
        npc_kind=kind,
        mission=_personalize_text(scenario, simulation.state, step["mission"]),
        name=guide["name"], role=guide["role"], rank=guide["rank"],
        personality=guide["personality"], likes=guide["likes"],
        dislikes=guide["dislikes"], speech_habits=guide["speech_habits"],
        responsibilities=guide["responsibilities"],
        state=simulation.state,
        affinity=50, affinity_band=affinity.band(50),
        knowledge=None,
        phase="orientation",
    )
    user = (
        "오늘 첫 출근한 신입을 데리고 팀을 한 바퀴 돌며 동료들을 소개하는 중입니다.\n"
        f"[동료 명단]\n{listing}\n\n"
        "opening에는 팀을 돌기 전에, 사수인 당신이 신입에게 먼저 자신의 이름과 직책·담당을 밝히며 "
        "가볍게 자기소개하는 말을 1~2문장으로 만드세요(동료 소개는 아직 하지 않습니다).\n"
        "각 동료 앞에 멈출 때마다 신입에게 그 사람을 소개하는 말을 1~2문장으로 만드세요. "
        "이름과 무슨 일을 하는 사람인지가 드러나야 합니다. 명단에 없는 사실은 지어내지 마세요.\n"
        "stops의 npc는 위 명단의 id를 그대로 씁니다.\n"
        "closing에는 소개를 마치고 오늘 업무가 전체적으로 어떻게 흘러가는지 2~3문장으로 짚어 주세요. "
        "구체적인 정답이나 풀이는 말하지 않습니다."
    )
    try:
        out = await get_llm().chat_json(
            [ChatMessage(role="user", content=user)], system=system, json_schema=_TOUR_SCHEMA
        )
        valid = {o["npc_id"] for o in others}
        stops = [s for s in out["stops"] if s["npc"] in valid]
        if len(stops) != len(others):  # 빠뜨린 동료가 있으면 통째로 폴백 (전원 소개가 계약)
            raise ValueError("투어 대사가 일부 동료를 빠뜨림")
        out = {"opening": out["opening"], "stops": stops, "closing": out["closing"]}
    except Exception:  # noqa: BLE001 — 투어 생성 실패가 게임을 막지 않게
        logger.warning("투어 대사 생성 실패 (simulation=%d) — 페르소나 문구로 폴백", simulation.id)
        out = fallback()

    by_id = {o["npc_id"]: o for o in others}
    return {
        "guide": {"npc": guide["npc_id"], "name": guide["name"], "role": guide["role"]},
        "opening": _clean_npc(out["opening"]),
        "stops": [
            {**s, "name": by_id[s["npc"]]["name"], "role": by_id[s["npc"]]["role"]}
            for s in out["stops"]
        ],
        "closing": _clean_npc(out["closing"]),
    }


async def finish_tour(
    session: AsyncSession, simulation: Simulation, scenario: Scenario
) -> dict:
    """투어를 끝까지 본 것으로 처리 — 팀 전원을 만난 것으로 기록해 업무 게이트를 연다.

    사수가 데리고 다니며 소개했으므로 신입이 한 명씩 말을 걸 필요는 없다. 호감도는
    건드리지 않는다(직접 대화한 태도만 호감도에 반영되어야 하므로).
    """
    roster = await npc_map(session, scenario.id)
    state = dict(simulation.state)
    state["met_npcs"] = list(roster.keys())
    state["tour_done"] = True
    simulation.state = state
    flag_modified(simulation, "state")
    await session.commit()
    return {"state": public_state(state), "step_changed": None}


def _minigame_result(payload: dict, declared: dict | None) -> dict:
    """미니게임 결과 페이로드 검증·정합 대조 → 저장할 결과 dict (순수 로직, 테스트 대상).

    declared = 시나리오에 선언된 게임 정의(content.minigame). 선언이 있으면 그 엔진만
    인정한다 — 프론트 자진신고를 믿지 않고 데이터와 대조 (사양 도착 후 전환, 2026-07-20).
    엔진 불일치는 에러로 끊지 않고 rejected 표시로 저장만 한다: 4단계 흐름은 막지 않되
    가짜 점수가 역량 블렌드에 못 들어가게 (aggregate.minigame_of가 거른다).
    """
    engine = str(payload.get("engine") or "").strip()
    if not engine:
        raise HTTPException(status_code=400, detail="미니게임 engine이 필요합니다")
    if engine == "research":
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            raise HTTPException(status_code=400, detail="자료 수집 게임 결과 metadata가 필요합니다")
        stage_results = metadata.get("stageResults")
        total_wrong = metadata.get("totalWrongAttempts")
        if (
            metadata.get("gameId") != "sns-content-research"
            or metadata.get("completed") is not True
            or metadata.get("totalStages") != 5
            or metadata.get("clearedStages") != 5
            or not isinstance(total_wrong, int)
            or isinstance(total_wrong, bool)
            or total_wrong < 0
            or not isinstance(stage_results, list)
            or len(stage_results) != 5
        ):
            raise HTTPException(
                status_code=400,
                detail="자료 수집 게임 결과 형식이 올바르지 않습니다",
            )
        clean_stages = []
        for index, stage_result in enumerate(stage_results):
            wrong = stage_result.get("wrongAttempts") if isinstance(stage_result, dict) else None
            if (
                not isinstance(stage_result, dict)
                or not isinstance(wrong, int)
                or isinstance(wrong, bool)
                or wrong < 0
                or stage_result.get("completed") is not True
            ):
                raise HTTPException(
                    status_code=400,
                    detail="스테이지별 오답 기록이 올바르지 않습니다",
                )
            clean_stages.append(
                {
                    "stageId": str(stage_result.get("stageId") or f"stage-{index + 1}"),
                    "stageIndex": index,
                    "keyword": str(stage_result.get("keyword") or ""),
                    "wrongAttempts": wrong,
                    "completed": True,
                }
            )
        if sum(item["wrongAttempts"] for item in clean_stages) != total_wrong:
            raise HTTPException(status_code=400, detail="전체 오답 횟수와 스테이지 합계가 다릅니다")
        result = {
            "engine": engine,
            "completed": True,
            "mistakes": total_wrong,
            "metadata": {
                "gameId": "sns-content-research",
                "completed": True,
                "totalStages": 5,
                "clearedStages": 5,
                "totalWrongAttempts": total_wrong,
                "stageResults": clean_stages,
                "completedAt": str(metadata.get("completedAt") or ""),
            },
        }
        if declared and engine != declared["engine"]:
            result["rejected"] = "engine_mismatch"
            result["declared_engine"] = declared["engine"]
        return result
    if engine == "design":
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            raise HTTPException(status_code=400, detail="시안 제작 게임 결과 metadata가 필요합니다")
        wrong_submissions = metadata.get("wrongSubmissionCount")
        duration_ms = metadata.get("durationMs")
        counters = {
            "moveCount": metadata.get("moveCount"),
            "undoCount": metadata.get("undoCount"),
            "resetCount": metadata.get("resetCount"),
        }
        if (
            metadata.get("gameId") != "sns-post-design"
            or metadata.get("completed") is not True
            or not isinstance(wrong_submissions, int)
            or isinstance(wrong_submissions, bool)
            or wrong_submissions < 0
            or not isinstance(duration_ms, (int, float))
            or isinstance(duration_ms, bool)
            or duration_ms < 0
            or any(
                not isinstance(value, int) or isinstance(value, bool) or value < 0
                for value in counters.values()
            )
        ):
            raise HTTPException(
                status_code=400,
                detail="시안 제작 게임 결과 형식이 올바르지 않습니다",
            )
        result = {
            "engine": engine,
            "completed": True,
            "mistakes": wrong_submissions,
            "metadata": {
                "gameId": "sns-post-design",
                "completed": True,
                "wrongSubmissionCount": wrong_submissions,
                "completedAt": str(metadata.get("completedAt") or ""),
                "durationMs": round(float(duration_ms)),
                **counters,
            },
        }
        if declared and engine != declared["engine"]:
            result["rejected"] = "engine_mismatch"
            result["declared_engine"] = declared["engine"]
        return result

    accuracy = payload.get("accuracy")
    if not isinstance(accuracy, (int, float)) or isinstance(accuracy, bool) or not 0 <= accuracy <= 100:
        raise HTTPException(status_code=400, detail="accuracy는 0~100 숫자여야 합니다")

    result: dict = {"engine": engine, "accuracy": round(float(accuracy), 1), "score": round(accuracy)}
    for key in ("time_seconds", "mistakes"):
        value = payload.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            result[key] = round(float(value), 1)

    if declared:
        if engine != declared["engine"]:
            logger.warning(
                "미니게임 engine 불일치 — 시나리오 선언 '%s' ≠ 수신 '%s' (저장만, 반영 안 함)",
                declared["engine"], engine,
            )
            result["rejected"] = "engine_mismatch"
            result["declared_engine"] = declared["engine"]
        else:
            # 통과 여부 — 리포트 서술용 ("재도전 끝에 통과" 등). 점수엔 이미 accuracy로 반영됨.
            # 반올림한 score가 아니라 원본 accuracy로 판정한다 — 69.5는 round시 70이 돼
            # pass_score=70을 통과로 기록하지만 저장된 accuracy(69.5)와 모순되기 때문.
            result["pass_score"] = declared["pass_score"]
            result["passed"] = float(accuracy) >= declared["pass_score"]
    return result


async def save_minigame_result(
    session: AsyncSession, simulation: Simulation, scenario: Scenario, payload: dict
) -> dict:
    """4단계 실무 미니게임 결과 저장 — 역량 블렌드·리포트의 재료 (팀 결정: B안).

    받는 것: {engine, accuracy(0~100), time_seconds?, mistakes?}
    점수는 정확도 기반(score = round(accuracy)). 시간·실수는 리포트 서술용으로만 보관하고
    당장 점수화하지 않는다(튜닝은 팀 논의 대상). 재도전하면 마지막 결과로 덮어쓴다.
    엔진은 시나리오의 게임 선언과 대조하고(_minigame_result), 스텁·불일치도 저장은 한다 —
    반영 여부는 aggregate.minigame_of가 거른다.
    """
    # 한 직무에 게임이 2~3개 붙는다. 첫 게임하고만 대조하면 두 번째 게임 결과가
    # 통째로 engine_mismatch로 버려진다 — 선언된 게임 중 engine이 같은 것을 찾아 대조한다.
    declared = minigame.declared_for_engine(scenario.slug, payload.get("engine"))
    result = _minigame_result(payload, declared)

    state = dict(simulation.state)
    # 게임이 여러 개여도 결과는 한 번만 온다 — 프론트(MiniGamePanel)가 게임들을 순서대로
    # 돌린 뒤 정확도 평균 하나로 합쳐 보내기 때문. 그래서 슬롯도 하나로 충분하다.
    # 게임별 점수를 따로 남기려면 전송 규약부터 바꿔야 하고, 그건 점수 설계라 팀 결정 사항.
    state["minigame"] = result
    simulation.state = state
    flag_modified(simulation, "state")
    await scoring.log_action(session, simulation.id, "minigame", result, {})
    await session.commit()
    return {"state": public_state(state), "step_changed": None}


ACTIVITY_TEXT_MAX = 1000


async def complete_activity(
    session: AsyncSession, simulation: Simulation, scenario: Scenario, payload: dict
) -> dict:
    """현재 후속 활동을 완료하고 다음 NPC/활동으로 전진한다.

    SNS-01처럼 기존 미션을 모두 끝낸 뒤 미니게임 → 회고 → 다른 NPC의 미니게임으로
    이어지는 흐름을 `state.step`에 저장한다. 게임 구현 전에는 minigame 활동의 완료
    신호만 받고, 실제 게임 결과 계약은 게임 확정 시 별도로 붙일 수 있다.
    """
    _ensure_active(simulation)
    state = dict(simulation.state)
    step = _resolve_step(scenario, state)
    activity = step.get("activity")
    if not isinstance(activity, dict):
        raise HTTPException(status_code=409, detail="현재 단계에는 완료할 후속 활동이 없습니다")

    kind = activity.get("kind")
    record: dict = {"kind": kind}
    if kind == "minigame":
        expected = str(activity.get("game_id") or "")
        received = str(payload.get("game_id") or "")
        if not expected or received != expected:
            raise HTTPException(status_code=400, detail="현재 단계의 미니게임이 아닙니다")
        record["game_id"] = expected
    elif kind == "debrief":
        content = str(payload.get("content") or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="진행하면서 느낀 점을 입력해주세요")
        content = content[:ACTIVITY_TEXT_MAX]
        answers = dict(state.get("debrief_answers") or {})
        answers[step["id"]] = content
        state["debrief_answers"] = answers
        record["content"] = content
    else:
        raise HTTPException(status_code=409, detail="지원하지 않는 후속 활동입니다")

    progress = dict(state.get("activity_progress") or {})
    progress[step["id"]] = record
    state["activity_progress"] = progress

    target = activity.get("on_complete")
    reflection_ready = target == "__reflection__"
    step_changed = None
    if reflection_ready:
        state["workflow_stage"] = "reflection"
    else:
        next_step = sm.find_step(scenario.steps, str(target))
        state["step"] = next_step["id"]
        state["workflow_stage"] = "exploring"
        step_changed = _public_step(scenario, state, next_step)

    simulation.state = state
    flag_modified(simulation, "state")
    await scoring.log_action(
        session,
        simulation.id,
        "activity_complete",
        {"step": step["id"], **record},
        {},
    )
    await session.commit()
    roster = await npc_map(session, scenario.id)
    completion_npc = roster.get((step.get("npcs") or [None])[0]) or {}
    return {
        "state": public_state(state),
        "step_changed": step_changed,
        "reflection_ready": reflection_ready,
        "completion_message": activity.get("completion_message"),
        "completion_name": completion_npc.get("name"),
    }


MEMO_MAX = 4000


async def save_memo(session: AsyncSession, simulation: Simulation, content: str) -> dict:
    """플레이어 메모 저장 — 사수가 알려주는 업무 내용을 직접 받아적는 학습 노트.

    자동 기록되는 업무 노트(브리핑 절차)와 달리 **플레이어가 스스로 적는** 글이다 — 직접
    적어야 학습이 된다는 팀 설계. 채점·리포트에 쓰지 않는 개인 메모장이므로 내용 검증 없이
    그대로 보관한다. 빈 문자열은 '지움'으로 허용, 저장할 때마다 덮어쓴다(단일 노트).
    새로고침·이어하기 시 state로 복원된다.
    """
    state = dict(simulation.state)
    state["memo"] = str(content or "")[:MEMO_MAX]
    simulation.state = state
    flag_modified(simulation, "state")
    await session.commit()
    return {"state": public_state(state), "step_changed": None}


REFLECTION_MAX = 1000


async def save_reflection(
    session: AsyncSession,
    simulation: Simulation,
    content: str,
    scenario: Scenario | None = None,
) -> dict:
    """5단계 — 체험자가 직접 쓴 소감문 저장.

    업무 산출물(미션)과 달리 **채점하지 않는다**. 점수·통과 판정 없이 최종 리포트의
    재료로만 쓰인다 (리포트 = 상담 + 수행 + 소감). 체험자 본인의 말이므로 내용을
    고치거나 평가하지 않고 그대로 보관한다.
    """
    text = (content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="소감을 입력해주세요")
    state = dict(simulation.state)
    state["reflection"] = text[:REFLECTION_MAX]
    completed_now = False
    if simulation.status == "active":
        if state.get("workflow_stage") != "reflection":
            raise HTTPException(status_code=409, detail="아직 체험 소감문 단계가 아닙니다")
        if scenario is None:
            raise HTTPException(status_code=409, detail="시나리오 정보를 확인할 수 없습니다")
        state["workflow_stage"] = "completed"
        simulation.status = "completed"
        completed_now = True
    simulation.state = state
    flag_modified(simulation, "state")
    await session.commit()
    if completed_now:
        try:
            await finalize_score(session, simulation, scenario)
        except Exception:  # noqa: BLE001 — 소감 저장·완주 자체는 점수 스냅샷 실패와 분리
            logger.exception(
                "소감문 완주 점수 스냅샷 실패 (simulation=%d)", simulation.id
            )
    return {"state": public_state(state), "step_changed": None}


async def npc_farewell(
    session: AsyncSession,
    simulation: Simulation,
    scenario: Scenario,
    step: dict,
    next_step: dict | None = None,
) -> dict | None:
    """방금 이 업무(step)를 마친 신입에게 담당 NPC가 건네는 짧은 격려('고생했다').

    실패·NPC 없음이면 None (프론트는 기본 문구 폴백). 부작용 없음.
    """
    npc_id = (step.get("npcs") or [None])[0]
    roster = await npc_map(session, scenario.id)
    persona = roster.get(npc_id or "")
    if persona is None:
        return None

    next_npc_id = ((next_step or {}).get("npcs") or [None])[0]
    next_persona = roster.get(next_npc_id or "")
    should_handoff = next_persona is not None and next_npc_id != npc_id
    handoff_name = next_persona["name"] if should_handoff else None
    if handoff_name:
        player_address = _player_address(simulation.state)
        next_address = (
            handoff_name
            if handoff_name.endswith(("님", "씨"))
            else f"{handoff_name}님"
        )
        handoff = f"{player_address}, {next_address}이 찾던데요? 한번 찾아가 봐요."
        prompt = (
            "신입이 방금 퀴즈와 업무를 마쳤습니다. 다음 담당자가 찾는다는 사실을 "
            f"현재 담당자인 당신이 알려주세요. 반드시 '{player_address}' 호칭과 "
            f"'{next_address}' 호칭을 모두 포함하고, '{handoff}'와 같은 흐름의 "
            "짧고 자연스러운 한두 문장으로 말하세요. 다음 업무의 정답이나 내용은 "
            "설명하지 말고, 다음 담당자 대신 먼저 업무를 건네지도 마세요."
        )
        fallback = handoff
    else:
        prompt = (
            "신입이 방금 이 업무를 마쳤습니다. 당신 성격대로 짧게 '수고했다'고 격려하며 "
            "마무리하세요. 1~2문장, 정답·다음 지시는 언급하지 말 것."
        )
        fallback = "고생했어요."
    try:
        text = await _persona_line(simulation, scenario, step, persona, prompt, temperature=0.6)
    except Exception:  # noqa: BLE001 — 격려 생성 실패가 통과를 막지 않게
        logger.warning("NPC 격려 생성 실패 (simulation=%d)", simulation.id)
        text = fallback
    text = text or fallback
    if handoff_name and (
        _player_address(simulation.state) not in text or handoff_name not in text
    ):
        text = fallback
    return {"npc": npc_id, "name": persona["name"], "text": text}


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
            _public_step(scenario, new_state, sm.find_step(scenario.steps, changed_step))
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

    # 제공자료가 있는 스텝은 '이번 세트의 정답(차액 원인)'을 채점 기준에 얹는다 —
    # 세트마다 원인이 달라, 시나리오에 고정으로 적힌 기준만으로는 맞는지 가릴 수 없다.
    task = _task_with_material_criteria(scenario, state, step, task)

    result = await _grade(session, simulation, scenario, step["mission"], task, submission)

    attempts = dict(state.get("attempts") or {})
    attempts[step["id"]] = attempts.get(step["id"], 0) + 1
    attempt_n = attempts[step["id"]]

    advice = None
    step_changed = None
    completed = False
    quest_fired = None
    next_step = None

    if result["passed"]:
        if task["on_pass"] == sm.END:
            simulation.status = "completed"
            completed = True
        else:
            next_id = task["on_pass"]
            state["step"] = next_id
            next_step = sm.find_step(scenario.steps, next_id)
            step_changed = _public_step(scenario, state, next_step)
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
    state["coach_streak"] = 0  # 제출 자체가 진전 신호 — 통과/미달 무관하게 정체 카운터 리셋
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

    # 통과 시 담당 NPC의 격려('고생했다') 문구 — 방금 마친 step 기준
    farewell = (
        await npc_farewell(
            session,
            simulation,
            scenario,
            step,
            next_step if quest_fired is None else None,
        )
        if result["passed"]
        else None
    )

    return _envelope(
        result,
        simulation.state,
        advice=advice,
        step_changed=step_changed,
        completed=completed,
        sudden_quest=quest_fired,
        coach=coach_cards,
        farewell=farewell,
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
    state["coach_streak"] = 0  # 제출 자체가 진전 신호 — 통과/미달 무관하게 정체 카운터 리셋
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


async def skip_step(
    session: AsyncSession, simulation: Simulation, scenario: Scenario
) -> dict:
    """테스트용 — 채점 없이 현재 미션을 통과 처리하고 다음 미션으로 전진(마지막이면 완주).

    돌발 퀘스트가 활성 중이면 퀘스트를 통과 처리하고 본편은 유지한다.
    """
    _ensure_active(simulation)
    state = dict(simulation.state)

    quest = dict(state.get("quest") or {"status": "none", "attempts": 0})
    if quest.get("status") == "active":
        quest["status"] = "passed"
        state["quest"] = quest
        simulation.state = state
        flag_modified(simulation, "state")
        await scoring.log_action(session, simulation.id, "skip_quest", {}, {})
        await session.commit()
        return {"step_changed": None, "completed": False, "state": public_state(simulation.state)}

    step = _resolve_step(scenario, state)
    on_pass = (step.get("task") or {}).get("on_pass")
    completed = False
    step_changed = None
    if on_pass is None or on_pass == sm.END:
        simulation.status = "completed"
        completed = True
    else:
        state["step"] = on_pass
        step_changed = _public_step(scenario, state, sm.find_step(scenario.steps, on_pass))
    simulation.state = state
    flag_modified(simulation, "state")
    await scoring.log_action(session, simulation.id, "skip_step", {"from": step["id"]}, {})
    await session.commit()
    if completed:
        try:
            await finalize_score(session, simulation, scenario)
        except Exception:  # noqa: BLE001 — 스냅샷 실패가 스킵을 막지 않게
            logger.exception("스킵 완주 점수 스냅샷 실패 (simulation=%d)", simulation.id)
    return {"step_changed": step_changed, "completed": completed, "state": public_state(simulation.state)}


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
