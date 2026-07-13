from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _load_script():
    path = ROOT / "scripts" / "test-coach-gemini.py"
    spec = importlib.util.spec_from_file_location("test_coach_gemini_script", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_all_coach_cases_render():
    module = _load_script()
    for case in module.CASES.values():
        rendered = module.render_case(case)
        assert "coach.response.v1" in rendered
        assert case["request_id"] in rendered


def test_semantic_validator_accepts_grounded_response():
    module = _load_script()
    case = module.CASES["missing-deadline"]
    result = {
        "request_id": case["request_id"],
        "run_id": case["run_id"],
        "mission_id": case["mission_id"],
        "stage_id": case["stage_id"],
        "cards": [
            {
                "card_type": "requirement_check",
                "evidence_refs": [{"event_id": "evt-001", "quote": "네, 정리해서 보내겠습니다."}],
                "source_chunk_ids": [],
            }
        ],
    }
    assert module.validate_semantics(result, case) == []


def test_semantic_validator_rejects_ungrounded_specifics():
    module = _load_script()
    case = module.CASES["safety-stop"]
    result = {
        "request_id": case["request_id"],
        "run_id": case["run_id"],
        "mission_id": case["mission_id"],
        "stage_id": case["stage_id"],
        "cards": [
            {
                "card_type": "safety_stop",
                "details": {"how_to_fix": ["비상 정지 버튼을 누릅니다."]},
                "evidence_refs": [],
                "source_chunk_ids": [],
            }
        ],
    }
    errors = module.validate_semantics(result, case)
    assert any("입력 근거에 없는 구체 정보 생성" in error for error in errors)


def test_semantic_validator_rejects_retry_for_success():
    module = _load_script()
    case = module.CASES["success"]
    result = {
        "request_id": case["request_id"],
        "run_id": case["run_id"],
        "mission_id": case["mission_id"],
        "stage_id": case["stage_id"],
        "retry_instruction": "다음 단계로 다시 시도해 주세요.",
        "cards": [{"card_type": "success", "evidence_refs": [], "source_chunk_ids": []}],
    }
    errors = module.validate_semantics(result, case)
    assert any("재시도 불필요 문구가 아님" in error for error in errors)
