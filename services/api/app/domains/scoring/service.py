"""scoring — 상태값 변화 계산 + 행동 로그 적재 (설계서 §4).

- 자유 대화: LLM이 발언의 영향을 평가해 delta 산출 (±10 클램프 — 코드에서 강제)
- 선택지: 시나리오 YAML의 effects 그대로 (룰 기반, 결정적)
"""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import ActionLog

CHAT_DELTA_LIMIT = 10
STATE_KEYS = ["trust", "schedule_stability", "requirement_clarity"]

_EVAL_SCHEMA = {
    "type": "object",
    "properties": {
        "deltas": {
            "type": "object",
            "properties": {k: {"type": "integer"} for k in STATE_KEYS},
            "required": STATE_KEYS,
            "additionalProperties": False,
        },
        "reason": {"type": "string"},
    },
    "required": ["deltas", "reason"],
    "additionalProperties": False,
}


async def evaluate_chat(mission: str, user_text: str, npc_reply: str) -> tuple[dict, str]:
    """사용자 발언의 상태 영향 평가 → (클램프된 deltas, 근거)."""
    system = render_prompt("scoring/evaluate.md", mission=mission)
    result = await get_llm().chat_json(
        [
            ChatMessage(
                role="user",
                content=f"사용자 발언: {user_text}\n상대(NPC) 반응: {npc_reply}",
            )
        ],
        system=system,
        json_schema=_EVAL_SCHEMA,
    )
    deltas = {
        k: max(-CHAT_DELTA_LIMIT, min(CHAT_DELTA_LIMIT, int(v)))
        for k, v in (result.get("deltas") or {}).items()
        if k in STATE_KEYS
    }
    return deltas, result.get("reason", "")


_TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "criterion": {"type": "string"},
                    "score": {"type": "integer"},
                    "comment": {"type": "string"},
                },
                "required": ["criterion", "score", "comment"],
                "additionalProperties": False,
            },
        },
        "total": {"type": "integer"},
        "feedback": {"type": "string"},
    },
    "required": ["scores", "total", "feedback"],
    "additionalProperties": False,
}


async def evaluate_task(
    mission: str, task: dict, transcript: str, submission: str
) -> dict:
    """과제 제출물 채점 → {scores, total, feedback, passed}."""
    system = render_prompt(
        "scoring/task.md",
        mission=mission,
        task_prompt=task["prompt"],
        criteria=task["criteria"],
        transcript=transcript or "(대화 없음)",
    )
    result = await get_llm().chat_json(
        [ChatMessage(role="user", content=f"## 제출물\n{submission}")],
        system=system,
        json_schema=_TASK_SCHEMA,
    )
    total = max(0, min(100, int(result.get("total", 0))))
    return {
        "scores": result.get("scores", []),
        "total": total,
        "feedback": result.get("feedback", ""),
        "passed": total >= task.get("pass_score", 70),
    }


# 룰 채점 과제 종류 — LLM 없이 결정적으로 채점 (라이트 메커니즘: 클릭·선택·배열)
RULE_KINDS = {"choice", "checklist", "order"}

CHECKLIST_WRONG_PENALTY = 30  # 오답 1개 선택당 감점


def _parse_selection(submission: str | list, valid_keys: set[str]) -> list[str]:
    """제출값 → 보기 key 목록. 문자열 "a,c" 와 JSON 배열 ["a","c"] 둘 다 허용."""
    if isinstance(submission, list):
        picked = [str(s).strip() for s in submission]
    else:
        picked = [p.strip() for p in str(submission or "").split(",")]
    picked = [p for p in picked if p]
    if not picked:
        raise HTTPException(status_code=400, detail="보기를 선택해 제출하세요")
    unknown = [p for p in picked if p not in valid_keys]
    if unknown:
        raise HTTPException(status_code=400, detail=f"존재하지 않는 보기: {unknown}")
    if len(set(picked)) != len(picked):
        raise HTTPException(status_code=400, detail="같은 보기를 중복 선택할 수 없음")
    return picked


def grade_structured(task: dict, submission: str | list) -> dict:
    """선택형·배열형 과제 룰 채점 — evaluate_task와 동일한 응답 계약.

    kind=choice     정답 1개 선택 (맞으면 100, 틀리면 0)
    kind=checklist  필요한 행동 모두 고르기 (정답 적중률 - 오답 감점)
    kind=order      올바른 순서로 배열 (쌍별 순서 일치율 — 인접 교환 정도는 통과)
    """
    kind = task["kind"]
    answer = task.get("answer") or {}
    valid_keys = {o["key"] for o in task.get("options", [])}
    picked = _parse_selection(submission, valid_keys)

    if kind == "choice":
        correct = answer.get("key")
        ok = picked == [correct]
        total = 100 if ok else 0
        comment = "정확한 판단이에요." if ok else "상황을 다시 떠올려보고 다른 보기를 검토해보세요."
    elif kind == "checklist":
        correct = set(answer.get("keys") or [])
        hit = correct & set(picked)
        wrong = set(picked) - correct
        total = round(100 * len(hit) / max(1, len(correct))) - CHECKLIST_WRONG_PENALTY * len(wrong)
        comment = f"필요한 행동 {len(correct)}개 중 {len(hit)}개를 골랐어요."
        if wrong:
            comment += f" 골라선 안 되는 행동이 {len(wrong)}개 섞여 있어요."
    else:  # order
        correct = list(answer.get("keys") or [])
        if set(picked) != set(correct):
            raise HTTPException(status_code=400, detail="모든 항목을 순서대로 배열해 제출하세요")
        pos = {k: i for i, k in enumerate(picked)}
        pairs = [(a, b) for i, a in enumerate(correct) for b in correct[i + 1:]]
        concordant = sum(1 for a, b in pairs if pos[a] < pos[b])
        total = round(100 * concordant / max(1, len(pairs)))
        comment = f"순서 판단 {concordant}/{len(pairs)} 일치."

    total = max(0, min(100, total))
    passed = total >= task.get("pass_score", 70)
    criterion = (task.get("criteria") or ["상황에 맞는 판단을 했는가"])[0]
    return {
        "scores": [{"criterion": criterion, "score": total, "comment": comment}],
        "total": total,
        "feedback": comment if not passed else "좋아요, 상황에 맞는 판단이었어요.",
        "passed": passed,
    }


def choice_effects(step: dict, choice_id: str) -> dict:
    """선택지의 룰 기반 effects 조회."""
    for choice in step.get("choices", []):
        if choice["id"] == choice_id:
            return choice.get("effects", {})
    raise HTTPException(status_code=400, detail=f"존재하지 않는 선택지: {choice_id}")


async def log_action(
    session: AsyncSession,
    simulation_id: int,
    type_: str,
    payload: dict,
    state_delta: dict,
) -> None:
    session.add(
        ActionLog(
            simulation_id=simulation_id,
            type=type_,
            payload=payload,
            state_delta=state_delta,
        )
    )
