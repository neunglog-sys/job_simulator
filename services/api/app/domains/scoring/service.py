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
