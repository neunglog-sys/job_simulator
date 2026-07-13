"""Gemini로 AI 코치 프롬프트와 coach.response.v1 계약을 단독 테스트한다."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "data" / "prompts" / "coach" / "response-schema.json"


CASES: dict[str, dict[str, Any]] = {
    "missing-deadline": {
        "forbidden_generated_terms": ["10월 25일", "기획안 초안"],
        "request_id": "req-coach-001",
        "run_id": "run-demo-001",
        "mission_id": "MISSION-DEMO-01",
        "stage_id": "S1",
        "mission": {
            "title": "킥오프 자료 준비",
            "instruction": "완료 날짜와 제출 산출물을 포함해 업무 수락 내용을 답한다.",
        },
        "current_stage": {"name": "업무요청 이해", "goal": "목적·마감·산출물을 확인한다."},
        "locked_rules": ["마감 날짜를 명시한다.", "제출 산출물을 명시한다."],
        "user_action": {
            "events": [
                {"event_id": "evt-001", "type": "npc_chat", "text": "네, 정리해서 보내겠습니다."}
            ]
        },
        "validation_result": {
            "status": "needs_retry",
            "issues": [
                {
                    "issue_id": "ISS-001",
                    "criterion_id": "CRIT-01",
                    "type": "missing_requirement",
                    "severity": "warning",
                    "event_id": "evt-001",
                    "observed_quote": "네, 정리해서 보내겠습니다.",
                    "expected": "완료 날짜와 제출 산출물을 함께 말한다.",
                }
            ],
        },
        "rubric": [
            {"criterion_id": "CRIT-01", "description": "마감과 산출물 명시", "result": "not_met"}
        ],
        "retrieved_context": [],
    },
    "safety-stop": {
        "forbidden_generated_terms": ["비상 정지 버튼", "전원 차단기", "행동을 수행함"],
        "request_id": "req-coach-002",
        "run_id": "run-demo-001",
        "mission_id": "MISSION-DEMO-02",
        "stage_id": "S4",
        "mission": {
            "title": "물류 분류라인 이상 대응",
            "instruction": "설비 이상 시 정지하고 현장 관리자에게 보고한다.",
        },
        "current_stage": {"name": "검수·판단", "goal": "안전위험을 식별하고 이관한다."},
        "locked_rules": ["가동 중인 컨베이어에 손을 넣지 않는다.", "설비 이상은 관리자에게 보고한다."],
        "user_action": {
            "events": [
                {"event_id": "evt-002", "type": "npc_chat", "text": "멈추지 않고 손으로 걸린 상자를 빼겠습니다."}
            ]
        },
        "validation_result": {
            "status": "safety_stop",
            "issues": [
                {
                    "issue_id": "ISS-002",
                    "criterion_id": "SAFE-01",
                    "type": "safety_violation",
                    "severity": "critical",
                    "event_id": "evt-002",
                    "observed_quote": "멈추지 않고 손으로 걸린 상자를 빼겠습니다.",
                    "expected": "설비를 정지하고 현장 관리자에게 이관한다.",
                }
            ],
        },
        "rubric": [
            {"criterion_id": "SAFE-01", "description": "가동 설비 접근 금지", "result": "violated"}
        ],
        "retrieved_context": [
            {"chunk_id": "J082-S4", "text": "설비 이상 시 작업을 멈추고 관리자에게 보고한다."}
        ],
    },
    "success": {
        "forbidden_generated_terms": ["다음 단계", "남은 인계", "다시 시도해", "재시도해"],
        "request_id": "req-coach-003",
        "run_id": "run-demo-001",
        "mission_id": "MISSION-DEMO-03",
        "stage_id": "S5",
        "mission": {"title": "업무 보고", "instruction": "결과와 남은 이슈를 보고한다."},
        "current_stage": {"name": "보고·인계", "goal": "결과·근거·다음 행동을 공유한다."},
        "locked_rules": ["완료 결과와 미결사항을 구분한다."],
        "user_action": {
            "events": [
                {
                    "event_id": "evt-003",
                    "type": "npc_chat",
                    "text": "예약 명단 대조를 완료했고, 신분 확인이 안 된 1건은 담당자 확인 대기 중입니다.",
                }
            ]
        },
        "validation_result": {"status": "passed", "issues": [], "successes": ["CRIT-03"]},
        "rubric": [
            {"criterion_id": "CRIT-03", "description": "결과와 미결사항 구분", "result": "met"}
        ],
        "retrieved_context": [],
    },
}


def render_case(case: dict[str, Any]) -> str:
    prompt_input = {key: value for key, value in case.items() if key != "forbidden_generated_terms"}
    return render_prompt("coach/system.md", **prompt_input)


def validate_semantics(result: dict[str, Any], case: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for key in ("request_id", "run_id", "mission_id", "stage_id"):
        if result.get(key) != case[key]:
            errors.append(f"{key} 불일치: expected={case[key]!r} actual={result.get(key)!r}")

    events = {event["event_id"]: event["text"] for event in case["user_action"].get("events", [])}
    allowed_chunks = {item["chunk_id"] for item in case.get("retrieved_context", [])}
    issue_event_ids = {
        issue["event_id"] for issue in case["validation_result"].get("issues", []) if issue.get("event_id")
    }
    for card in result.get("cards", []):
        for evidence in card.get("evidence_refs", []):
            event_id = evidence.get("event_id")
            quote = evidence.get("quote", "")
            if event_id not in events:
                errors.append(f"알 수 없는 evidence event_id: {event_id}")
            elif quote not in events[event_id]:
                errors.append(f"사용자 행동에 없는 인용: {quote!r}")
            if case["validation_result"].get("issues") and event_id not in issue_event_ids:
                errors.append(f"검증 이슈에 없는 evidence event_id: {event_id}")
        unknown_chunks = set(card.get("source_chunk_ids", [])) - allowed_chunks
        if unknown_chunks:
            errors.append(f"검색 근거에 없는 chunk_id: {sorted(unknown_chunks)}")

    if case["validation_result"]["status"] == "safety_stop":
        cards = result.get("cards", [])
        if not cards or cards[0].get("card_type") != "safety_stop":
            errors.append("안전 위반인데 첫 카드가 safety_stop이 아님")
    if case["validation_result"]["status"] == "passed":
        cards = result.get("cards", [])
        if not cards or any(card.get("card_type") != "success" for card in cards):
            errors.append("통과 상태인데 success 이외의 카드가 생성됨")
        if result.get("retry_instruction") != "재시도할 필요가 없습니다.":
            errors.append("통과 상태의 retry_instruction이 재시도 불필요 문구가 아님")
    serialized = json.dumps(result, ensure_ascii=False)
    for term in case.get("forbidden_generated_terms", []):
        if term in serialized:
            errors.append(f"입력 근거에 없는 구체 정보 생성: {term!r}")
    return errors


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=sorted(CASES), default="missing-deadline")
    parser.add_argument("--dry-run", action="store_true", help="API 호출 없이 렌더링만 확인")
    parser.add_argument("--show-prompt", action="store_true")
    args = parser.parse_args()

    case = CASES[args.case]
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    system = render_case(case)
    if args.show_prompt:
        print(system)
    if args.dry_run:
        print(f"PASS: prompt rendered case={args.case} chars={len(system)}")
        return

    llm = get_llm()
    if llm.provider.name != "gemini":
        raise SystemExit(
            f"Gemini가 선택되지 않았습니다(provider={llm.provider.name}). "
            ".env의 LLM_PROVIDER와 GEMINI_API_KEY를 확인하세요."
        )

    result = await llm.chat_json(
        [ChatMessage(role="user", content="제공된 검증 결과만 근거로 AI 코치 응답을 생성하세요.")],
        system=system,
        json_schema=schema,
        temperature=0.2,
    )
    schema_errors = [error.message for error in Draft202012Validator(schema).iter_errors(result)]
    semantic_errors = validate_semantics(result, case)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if schema_errors or semantic_errors:
        for error in schema_errors:
            print(f"SCHEMA_ERROR: {error}")
        for error in semantic_errors:
            print(f"SEMANTIC_ERROR: {error}")
        raise SystemExit(1)
    print(f"PASS: case={args.case} provider={llm.provider.name} cards={len(result['cards'])}")


if __name__ == "__main__":
    asyncio.run(main())
