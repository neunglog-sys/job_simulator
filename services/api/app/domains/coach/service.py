"""AI 코치 카드 — 미션 통과 시 완료당 1회, 제출물 사후 리뷰 (태수·영수 합의 설계).

- 진행 중 미달 힌트는 hints.py(룰 기반)가 담당 — 코치는 '제출된 산출물'에 대해서만 발화
- 프롬프트·응답 계약은 영수님 정의(data/prompts/coach/) 그대로 사용: coach.response.v1
- 생성 실패(LLM 오류·스키마 불일치·mock)는 조용히 생략 — 게임 진행을 절대 막지 않음
"""

import json
import logging
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

from app.core.config import settings
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt

logger = logging.getLogger(__name__)


@lru_cache
def _response_schema() -> dict:
    path = Path(settings.data_dir) / "prompts" / "coach" / "response-schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


def build_vars(
    *,
    simulation_id: int,
    scenario_slug: str,
    step: dict,
    task: dict,
    submission: str,
    result: dict,
    attempt: int,
) -> dict:
    """엔진 데이터 → 코치 프롬프트 입력 계약 매핑."""
    weak = [
        s for s in result.get("scores", [])
        if isinstance(s.get("score"), (int, float)) and s["score"] < task.get("pass_score", 70)
    ]
    return {
        "request_id": f"coach-{simulation_id}-{step['id']}-{attempt}",
        "run_id": str(simulation_id),
        "mission_id": f"{scenario_slug}:{step['id']}",
        "stage_id": step["id"],
        "mission": {
            "mission_id": f"{scenario_slug}:{step['id']}",
            "objective": step.get("mission", ""),
            "deliverable": task.get("prompt", ""),
        },
        "current_stage": {"stage_id": step["id"], "title": step.get("title", "")},
        "locked_rules": {
            "required_actions": task.get("criteria", []),
            "forbidden_actions": [],
        },
        "user_action": {
            "event_id": f"submit-{simulation_id}-{step['id']}-{attempt}",
            "text": submission,
        },
        "validation_result": {
            "status": "passed" if result.get("passed") else "failed",
            "total": result.get("total"),
            "issues": [
                f"{s.get('criterion', '')}: {s.get('comment', '')}" for s in weak
            ],
            "feedback": result.get("feedback", ""),
        },
        "rubric": {
            s.get("criterion", f"기준{i}"): {"score": s.get("score"), "max_score": 100}
            for i, s in enumerate(result.get("scores", []), 1)
        },
        "retrieved_context": [],  # KB 청크 연동은 실키 확보 후 (get_stage_chunk)
    }


async def generate_cards(vars_: dict) -> dict | None:
    """코치 응답 생성 + 계약 검증 — 실패 시 None (진행 비차단)."""
    try:
        system = render_prompt("coach/system.md", **vars_)
        response = await get_llm().chat_json(
            [ChatMessage(role="user", content="위 입력 데이터로 coach.response.v1 JSON을 생성하세요.")],
            system=system,
            json_schema=_response_schema(),
        )
        Draft202012Validator(_response_schema()).validate(response)
        return response
    except Exception:  # noqa: BLE001 — 코치 실패가 게임을 막으면 안 됨 (mock 환경 포함)
        logger.info("코치 카드 생성 생략 (simulation=%s)", vars_.get("run_id"))
        return None
