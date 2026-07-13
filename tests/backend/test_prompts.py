"""llm/prompts — 템플릿 렌더링 (data/prompts 실제 파일 대상, 변수 누락 감지)."""

import json
from pathlib import Path

import pytest
from jinja2 import exceptions

from app.llm.prompts import render_prompt


def test_avatar_system_renders():
    out = render_prompt("avatar/system.md", summary=None, knowledge=None)
    assert "상담사" in out
    assert "{{" not in out  # 미치환 변수 없음


def test_avatar_summary_injected():
    out = render_prompt(
        "avatar/system.md", summary="사용자는 데이터 분석을 좋아함", knowledge=None
    )
    assert "사용자는 데이터 분석을 좋아함" in out


def test_avatar_knowledge_injected():
    out = render_prompt(
        "avatar/system.md",
        summary=None,
        knowledge="[backend-developer/daily-work.md]\n백엔드 개발자의 하루는...",
    )
    assert "백엔드 개발자의 하루는" in out
    # 지식 없을 땐 해당 섹션 자체가 없어야 함
    empty = render_prompt("avatar/system.md", summary=None, knowledge=None)
    assert "참고 직무 지식" not in empty


def test_missing_variable_raises():
    # StrictUndefined — 변수 빠뜨리면 조용히 넘어가지 않고 에러
    with pytest.raises(exceptions.UndefinedError):
        render_prompt("avatar/system.md")


def test_report_prompt_renders():
    out = render_prompt(
        "job-master/consult-report.md",
        recommendations=[{"job_title": "백엔드 개발자", "score": 80, "reason": "근거"}],
        competencies=[{"key": "communication", "name": "커뮤니케이션", "description": "설명"}],
        performance=None,
    )
    assert "백엔드 개발자" in out
    assert "커뮤니케이션" in out
    assert "시뮬레이션" not in out  # 수행 데이터 없으면 해당 섹션 미출력


def test_report_prompt_with_performance():
    out = render_prompt(
        "job-master/consult-report.md",
        recommendations=[{"job_title": "백엔드 개발자", "score": 80, "reason": "근거"}],
        competencies=[{"key": "communication", "name": "커뮤니케이션", "description": "설명"}],
        performance={
            "scenario_title": "의료·복지·상담 응대 — 신입의 하루",
            "total": 82,
            "mission_avg": 85,
            "competencies": {"communication": 81, "collaboration": None},
            "missions": [{"type": "정상업무", "adjusted": 85, "attempts": 1}],
            "quest": {"status": "passed", "adjusted": 70},
        },
    )
    assert "시나리오 총점: 82점" in out
    assert "돌발 퀘스트: 통과" in out
    assert "collaboration" not in out  # None 역량은 미표기


def test_npc_system_is_instruction_only_and_renders():
    out = render_prompt(
        "npc/system.md",
        scenario_title="총무·행정·사무보조 — 신입의 하루",
        mission="워크숍 자료 준비",
        name="박연나",
        role="총무 담당",
        rank="과장",
        personality=["꼼꼼함", "원칙적"],
        likes=["명확한 보고"],
        dislikes=["확인 없는 단정"],
        speech_habits=["근거가 뭐예요?"],
        responsibilities=["워크숍 준비 총괄"],
        state={"trust": 50, "schedule_stability": 60, "requirement_clarity": 40},
        knowledge=None,
    )
    assert "박연나" in out and "총무 담당" in out  # 필드 조립 확인
    assert "지시·요청·질문·사실 확인" in out
    assert "사용자의 답을 채점" in out
    assert "힌트를 제공하지 않습니다" in out
    assert "자연스러운 직장 존댓말" in out
    assert "유자격자 또는 현장 관리자" in out
    assert "규칙 낭독으로 시작하지 말고" in out
    assert "업무를 진행하고 결과를 보고해 주세요" in out
    assert "NPC 본인의 이름/직급" in out
    assert "사용자 이름·직급이 입력에 별도로 없으면" in out
    assert "이미 사건이 발생했다는 증거가 아닙니다" in out
    assert "날짜·기간·부서·사람·문서·예산·장비" in out
    assert "페르소나의 일반적인 업무 예시는 사실 근거로 인정하지 않습니다" in out
    assert "누락 여부를 확인해 주세요" in out
    assert "구체적으로 보이기 위해 정보를 추가하지 않습니다" in out
    assert "{{" not in out


def test_coach_system_renders_structured_card_context():
    out = render_prompt(
        "coach/system.md",
        request_id="coach-req-1",
        run_id="run-1",
        mission_id="MS-04-04",
        stage_id="S4",
        mission={"mission_id": "MS-04-04", "objective": "통관 보류 자료 정리"},
        current_stage={"stage_id": "S4", "title": "검토 요청 작성"},
        locked_rules={"required_actions": ["출고 보류"], "forbidden_actions": []},
        user_action={"event_id": "evt-1", "text": "오늘 처리될 것 같습니다."},
        validation_result={"issues": ["확인되지 않은 기한 약속"]},
        rubric={"communication": {"max_score": 15}},
        retrieved_context=[],
    )
    assert "AI 코치" in out
    assert "우측 카드" in out
    assert "coach.response.v1" in out
    assert "계획·의사를 이미" in out
    assert "{{" not in out


def test_coach_response_schema_has_required_card_contract():
    root = Path(__file__).resolve().parents[2]
    schema = json.loads(
        (root / "data" / "prompts" / "coach" / "response-schema.json").read_text(
            encoding="utf-8"
        )
    )
    assert schema["properties"]["contract"]["type"] == "string"
    assert schema["properties"]["contract"]["enum"] == ["coach.response.v1"]
    assert {"request_id", "run_id", "mission_id", "stage_id"}.issubset(
        schema["required"]
    )
    assert schema["properties"]["cards"]["maxItems"] == 3
    card_types = schema["$defs"]["card"]["properties"]["card_type"]["enum"]
    assert "error_correction" in card_types
    assert "requirement_check" in card_types
    assert "better_expression" in card_types


def test_coach_example_response_matches_contract_shape():
    root = Path(__file__).resolve().parents[2]
    example = json.loads(
        (root / "data" / "prompts" / "coach" / "example-response.json").read_text(
            encoding="utf-8"
        )
    )
    assert example["contract"] == "coach.response.v1"
    assert len(example["cards"]) == 3
    assert [card["card_type"] for card in example["cards"]] == [
        "error_correction",
        "requirement_check",
        "better_expression",
    ]
    assert all(card["details"]["how_to_fix"] for card in example["cards"])
