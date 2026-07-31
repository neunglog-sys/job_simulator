"""scoring — 상태값 변화 계산 + 행동 로그 적재 (설계서 §4).

- 자유 대화: LLM이 발언의 영향을 평가해 delta 산출 (±10 클램프 — 코드에서 강제)
- 선택지: 시나리오 YAML의 effects 그대로 (룰 기반, 결정적)
"""

import logging
import statistics

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import RULE_KINDS
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import ActionLog

logger = logging.getLogger(__name__)

__all__ = ["RULE_KINDS"]  # 재노출 — 기존 scoring.RULE_KINDS 참조 유지

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


# 합격선에서 이만큼 안쪽이면 한 번 더 채점해 중앙값으로 판정한다.
#
# 온도 0 + 사고 토큰 0으로도 점수는 완전히 고정되지 않는다(실측: 같은 답안 8회에 sd 3.5~4.2).
# Gemini에 seed가 없어 원리적으로 비결정적이다. 그런데 사용자에게 해로운 건 95냐 100이냐가
# 아니라 **합불이 갈리는 것**이다 — 같은 답안을 내고 어떤 날은 통과, 어떤 날은 미달이면
# 원인을 알 수가 없다. 그래서 경계 근처에서만 표본을 늘려 그 뒤집힘을 줄인다.
# 밴드 밖(명백한 통과·명백한 미달)은 한 번으로 끝내 비용을 늘리지 않는다.
BOUNDARY_BAND = 6
BOUNDARY_SAMPLES = 3


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
        # 채점기는 측정 도구다 — 같은 답안은 같은 점수를 받아야 한다. 기본값(0.3)을 그대로
        # 쓰다가 동일 답안 5회 재채점에서 sd 1.73점, 9답안 중 2개가 합불이 갈렸다(0728 감사).
        # 사용자는 왜 결과가 달라졌는지 알 방법이 없다.
        #
        # ⚠️ temperature만 0으로 내려서는 안 잡힌다(실측: sd 3.78 → 3.81, 변화 없음).
        # Gemini는 사고 토큰이 기본 활성이고 **그 과정이 온도와 무관하게 흔들리기** 때문이다.
        # thinking_budget=0이 실제로 재현성을 만드는 쪽이다.
        temperature=0.0,
        thinking_budget=0,
    )
    total = max(0, min(100, int(result.get("total", 0))))
    pass_score = task.get("pass_score", 70)

    # 경계 근처면 표본을 늘려 중앙값으로 판정한다 — 합불 뒤집힘만 겨냥한 조치다.
    if abs(total - pass_score) <= BOUNDARY_BAND:
        totals = [total]
        for _ in range(BOUNDARY_SAMPLES - 1):
            try:
                extra = await get_llm().chat_json(
                    [ChatMessage(role="user", content=f"## 제출물\n{submission}")],
                    system=system,
                    json_schema=_TASK_SCHEMA,
                    temperature=0.0,
                    thinking_budget=0,
                )
            except Exception:  # noqa: BLE001 — 추가 표본 실패가 채점을 막으면 안 된다
                logger.warning("경계 재채점 실패 — 있는 표본으로 판정한다")
                break
            totals.append(max(0, min(100, int(extra.get("total", 0)))))
        if len(totals) > 1:
            median = int(statistics.median(totals))
            logger.info(
                "[GRADE-BOUNDARY] pass=%d samples=%s -> median=%d", pass_score, totals, median
            )
            total = median

    return {
        "scores": result.get("scores", []),
        "total": total,
        "feedback": _truncate_feedback(result.get("feedback", "")),
        "passed": total >= pass_score,
    }


FEEDBACK_MAX_CHARS = 200


def _truncate_feedback(text: str) -> str:
    """AI 코치가 음성으로 말하는 문구 — 프롬프트로 200자를 유도해도 LLM이 넘길 수 있어 코드에서 강제."""
    if len(text) <= FEEDBACK_MAX_CHARS:
        return text
    cut = text[:FEEDBACK_MAX_CHARS]
    last_sentence_end = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"), cut.rfind("다."))
    if last_sentence_end >= FEEDBACK_MAX_CHARS // 2:
        return cut[: last_sentence_end + 1]
    return cut.rstrip() + "…"


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
    # 손상된 과제(보기·정답 누락)는 사용자를 무한 400 dead-end에 빠뜨리는 대신 서버 오류로
    # 시끄럽게 드러낸다 — 로드 검증을 우회한 DB 행이 있으면 콘텐츠 문제로 잡히게.
    answer_keys = ([answer["key"]] if "key" in answer else []) if kind == "choice" \
        else list(answer.get("keys") or [])
    if not valid_keys or not answer_keys:
        raise HTTPException(
            status_code=500,
            detail=f"과제 설정 오류: '{kind}' 보기 또는 정답 누락 (시나리오 데이터 점검 필요)",
        )
    picked = _parse_selection(submission, valid_keys)

    if kind == "choice":
        if len(picked) != 1:  # 복수 선택을 조용히 0점 처리하지 않고 명시적 거부
            raise HTTPException(status_code=400, detail="보기를 하나만 선택하세요")
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
