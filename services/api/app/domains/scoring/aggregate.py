"""정밀 점수제 집계 (2026-07-13 팀 확정) — 순수 함수 + 로그 수집.

- 미션 인정점수 = 채점 점수 × 자력 보정 (사용한 최고 힌트 레벨 기준)
- 시나리오 총점 = 일과 미션 평균 80% + 돌발 퀘스트 20%
  (퀘스트 실패 = 0점, 미발동 = 미션 평균으로 대체 — 운에 의한 불이익 방지)
- 역량 5종 = 미션 유형 매핑 가중평균, 협업·커뮤니케이션은 대화 상태값 30% 블렌드
"""

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ActionLog

MIN_PERCENTILE_SAMPLE = 30  # 이 미만이면 백분위 숨김 (요동치는 "상위 67%" 방지)

# 자력 보정: 통과 전에 본 최고 힌트 레벨 → 배율
SELF_RELIANCE = {0: 1.0, 1: 0.9, 2: 0.8, 3: 0.7}

MISSION_WEIGHT = 0.8
QUEST_WEIGHT = 0.2
STATE_BLEND = 0.3  # 협업·커뮤니케이션에 섞는 대화 상태값 비중

# 미션 상황유형 → 역량 가중치 (주역량 1.0, 보조 0.5)
TYPE_COMPETENCY = {
    "정상업무": {"task_management": 1.0},
    "자료·정보 누락": {"situation_judgment": 1.0, "problem_solving": 0.5},
    "우선순위 충돌": {"problem_solving": 1.0, "task_management": 0.5},
    "오류·안전위험": {"situation_judgment": 1.0, "problem_solving": 0.5},
    "보고·인계": {"communication": 1.0, "collaboration": 0.5},
}
STATE_BLENDED = ("collaboration", "communication")  # 상태값을 블렌드하는 역량
COMPETENCY_KEYS = [
    "situation_judgment",
    "problem_solving",
    "communication",
    "collaboration",
    "task_management",
]


def adjusted_score(raw_total: int, max_hint_level: int) -> int:
    """인정점수 — 정답 가이드를 봤어도 직접 제출해 통과했으므로 0은 아니지만 보정."""
    modifier = SELF_RELIANCE.get(min(max_hint_level, 3), 0.7)
    return round(raw_total * modifier)


def collect_from_logs(logs: list[dict]) -> tuple[dict, dict | None]:
    """action_logs(payload dict 목록)에서 스텝별 통과 기록·퀘스트 기록 추출.

    반환: (missions: {step_id: {"raw", "max_hint", "attempts"}}, quest 또는 None)
    """
    missions: dict[str, dict] = {}
    quest: dict | None = None

    for log in logs:
        p = log["payload"]
        if log["type"] == "task_submit":
            rec = missions.setdefault(
                p["step"], {"raw": None, "max_hint": 0, "attempts": 0}
            )
            if rec["raw"] is not None:
                continue  # 첫 통과가 확정 — 이후 재제출은 점수·힌트에 소급 반영하지 않음
            rec["attempts"] = p.get("attempt", rec["attempts"] + 1)
            if p.get("passed"):
                rec["raw"] = p.get("total", 0)
            else:
                rec["max_hint"] = max(rec["max_hint"], p.get("hint_level", 0))
        elif log["type"] == "quest_submit":
            quest = quest or {"raw": None, "max_hint": 0, "attempts": 0, "status": "failed"}
            if quest["raw"] is not None:
                continue  # 퀘스트도 첫 통과 확정 후 불변
            quest["attempts"] = p.get("attempt", quest["attempts"] + 1)
            if p.get("passed"):
                quest["raw"] = p.get("total", 0)
                quest["status"] = "passed"
            else:
                # 퀘스트 힌트도 카드가 나갔으면 보정 대상 (attempt 1 실패 = 레벨1 카드)
                quest["max_hint"] = max(quest["max_hint"], min(p.get("attempt", 1), 3))
    return missions, quest


def scenario_score(
    steps: list[dict], missions: dict, quest: dict | None
) -> dict:
    """시나리오 총점 + 미션별 상세. steps에서 유형(type)을 찾아 붙인다."""
    step_types = {s["id"]: s.get("type") for s in steps}

    mission_rows = []
    for step_id, rec in missions.items():
        if rec["raw"] is None:  # 미통과 스텝은 집계 제외 (중도 상태)
            continue
        adj = adjusted_score(rec["raw"], rec["max_hint"])
        mission_rows.append(
            {
                "step": step_id,
                "type": step_types.get(step_id),
                "raw": rec["raw"],
                "adjusted": adj,
                "attempts": rec["attempts"],
                "max_hint_level": rec["max_hint"],
            }
        )

    mission_avg = (
        round(sum(m["adjusted"] for m in mission_rows) / len(mission_rows))
        if mission_rows
        else 0
    )

    quest_row = None
    if quest is not None:
        q_adj = (
            adjusted_score(quest["raw"], quest["max_hint"])
            if quest["status"] == "passed" and quest["raw"] is not None
            else 0
        )
        quest_row = {**quest, "adjusted": q_adj}
        quest_score = q_adj
    else:
        quest_score = mission_avg  # 미발동 — 운에 의한 불이익 방지 (미션 평균 대체)

    total = round(mission_avg * MISSION_WEIGHT + quest_score * QUEST_WEIGHT)
    return {
        "missions": mission_rows,
        "quest": quest_row,
        "mission_avg": mission_avg,
        "total": total,
    }


def competency_scores(
    mission_rows: list[dict],
    quest_row: dict | None,
    quest_type: str | None,
    state: dict,
) -> dict[str, int]:
    """역량 5종 점수 — 유형 매핑 가중평균 + 협업·커뮤니케이션 상태값 블렌드."""
    acc: dict[str, list[tuple[float, float]]] = {k: [] for k in COMPETENCY_KEYS}

    entries = [(m["type"], m["adjusted"]) for m in mission_rows]
    if quest_row is not None:
        entries.append((quest_type, quest_row["adjusted"]))

    for type_, score in entries:
        for key, weight in TYPE_COMPETENCY.get(type_ or "", {}).items():
            acc[key].append((score, weight))

    numeric_state = [
        v
        for k, v in state.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool) and k != "step"
    ]
    state_avg = sum(numeric_state) / len(numeric_state) if numeric_state else None

    result = {}
    for key in COMPETENCY_KEYS:
        pairs = acc[key]
        mission_based = (
            sum(s * w for s, w in pairs) / sum(w for _, w in pairs) if pairs else None
        )
        if key in STATE_BLENDED and state_avg is not None:
            if mission_based is None:
                value = state_avg
            else:
                value = mission_based * (1 - STATE_BLEND) + state_avg * STATE_BLEND
        else:
            value = mission_based
        result[key] = round(value) if value is not None else None
    return result


async def simulation_score(session: AsyncSession, simulation, scenario) -> dict:
    """DB에서 로그를 모아 시나리오 점수·역량 점수 산출 (진행 중이면 부분 집계)."""
    logs = [
        {"type": row.type, "payload": row.payload}
        for row in (
            await session.execute(
                select(ActionLog)
                .where(ActionLog.simulation_id == simulation.id)
                .order_by(ActionLog.id)
            )
        ).scalars()
    ]
    missions, quest = collect_from_logs(logs)
    score = scenario_score(scenario.steps, missions, quest)
    quest_type = (scenario.sudden_quest or {}).get("task", {}).get("type") if scenario.sudden_quest else None
    competencies = competency_scores(
        score["missions"], score["quest"], quest_type, simulation.state
    )
    return {
        "simulation_id": simulation.id,
        "status": simulation.status,
        **score,
        "competencies": competencies,
    }


async def scenario_percentile(
    session: AsyncSession, scenario_id: int, total: int, exclude_simulation_id: int
) -> dict:
    """같은 시나리오 완주자 대비 상위 % — 모수 부족하면 top_percent=None (숨김).

    모수 = 완료 시점에 state['score']가 스냅샷된 완주 시뮬레이션들 (자기 자신 제외 —
    스냅샷 전/후 어느 시점에 조회해도 계산이 일관되도록). 중도 포기(aborted)는 제외.
    """
    rows = (
        await session.execute(
            text(
                "SELECT (state #>> '{score,total}')::int FROM simulations "
                "WHERE scenario_id = :sid AND status = 'completed' "
                "AND id != :self_id AND (state #>> '{score,total}') IS NOT NULL"
            ),
            {"sid": scenario_id, "self_id": exclude_simulation_id},
        )
    ).scalars()
    totals = [t for t in rows if t is not None]
    n = len(totals)  # 나를 제외한 완주자 수
    if n == 0:
        return {"sample_size": 0, "top_percent": None}
    higher = sum(1 for t in totals if t > total)
    top = round((higher + 1) / (n + 1) * 100)  # 내 등수 / (모수 + 나)
    return {
        "sample_size": n,
        "top_percent": top if n >= MIN_PERCENTILE_SAMPLE else None,
    }
