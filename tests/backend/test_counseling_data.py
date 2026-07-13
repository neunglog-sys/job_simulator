"""상담 데이터팩(data/counseling/*.json) — 무결성 + 규칙 기반 로직 테스트.

DB/LLM에 의존하지 않는 순수 데이터·순수 함수 테스트만 포함한다
(app.content.counseling은 DB 세션도 LLM 호출도 쓰지 않음).
"""
import re
from pathlib import Path

import pytest

from app.content import counseling as cs
from app.core.config import settings

REAL_MODULES = {
    "대인응대형", "절차·점검형", "작업순서·절차형", "제작·상태판단형",
    "돌발상황 대처형", "안전·위험판단형", "장비·상태점검형", "정보·판단형",
}


def _registered_source_ids() -> set[str]:
    # docker-compose는 data/ 와 tests/ 만 마운트하고 docs/ 는 마운트하지 않는다
    # (infra/docker-compose*.yml 참고). 컨테이너 안에서는 이 파일에 접근할 수 없으므로
    # 그 경우엔 스킵하고, repo root 기준 로컬/CI 실행에서는 실제로 검증한다.
    candidates = [
        Path(settings.data_dir).parent / "docs" / "counseling" / "source_registry.md",
        Path(__file__).resolve().parents[2] / "docs" / "counseling" / "source_registry.md",
    ]
    for path in candidates:
        if path.exists():
            text = path.read_text(encoding="utf-8")
            return set(re.findall(r"^### (SRC-[A-Z0-9-]+)$", text, flags=re.MULTILINE))
    pytest.skip(
        "docs/counseling/source_registry.md에 접근 불가 — Docker 컨테이너엔 docs/가 "
        "마운트되지 않음. scripts/validate_counseling_data.py(repo root 실행)가 이 검증을 강제한다."
    )


# ══════════════════════════════════════════════════════════════════════
# 데이터 무결성
# ══════════════════════════════════════════════════════════════════════

def test_question_ids_unique():
    ids = [q["question_id"] for q in cs.load_question_bank()]
    assert len(ids) == len(set(ids))


def test_no_empty_or_duplicate_question_text():
    questions = cs.load_question_bank()
    texts = [q["question"] for q in questions]
    assert all(t.strip() for t in texts)
    assert len(texts) == len(set(texts))


def test_question_target_dimensions_are_valid():
    dim_codes = {d["dimension_code"] for d in cs.load_dimension_definitions()}
    for q in cs.load_question_bank():
        for dim in q["target_dimensions"]:
            assert dim in dim_codes, f"{q['question_id']}: 알 수 없는 축 {dim}"


def test_followup_question_ids_resolve():
    ids = {q["question_id"] for q in cs.load_question_bank()}
    for q in cs.load_question_bank():
        for fid in q["followup_question_ids"]:
            assert fid in ids


def test_dimension_definitions_count_and_uniqueness():
    dims = cs.load_dimension_definitions()
    assert len(dims) == 43
    codes = [d["dimension_code"] for d in dims]
    assert len(codes) == len(set(codes))


def test_dimension_related_module_ids_match_real_modules():
    for d in cs.load_dimension_definitions():
        for mid in d["related_module_ids"]:
            assert mid in REAL_MODULES


def test_all_source_ids_registered():
    known = _registered_source_ids()
    assert known, "source_registry.md에서 source_id를 하나도 못 읽었음"
    for q in cs.load_question_bank():
        for sid in q["source_ids"]:
            assert sid in known, f"{q['question_id']}: 미등록 source_id {sid}"
    for d in cs.load_dimension_definitions():
        for sid in d["source_ids"]:
            assert sid in known, f"{d['dimension_code']}: 미등록 source_id {sid}"
    for rule in cs.load_safety_rules()["rules"]:
        for sid in rule["source_ids"]:
            assert sid in known, f"{rule['rule_id']}: 미등록 source_id {sid}"


def test_representative_missions_are_40_and_cover_all_categories():
    mapping = cs.load_module_mapping()
    missions = mapping["representative_missions"]
    assert len(missions) == 40
    mission_codes = [m["mission_code"] for m in missions]
    assert len(mission_codes) == len(set(mission_codes))

    all_categories = {c for m in mapping["modules"] for c in m["categories"]}
    mission_categories = {m["category"] for m in missions}
    assert mission_categories == all_categories


def test_module_mapping_never_uses_riasec_alone():
    # RIASEC(interest.*)만으로 모듈을 확정하지 않는다는 명시 원칙이 disclaimer에 있어야 함
    assert "RIASEC" in cs.load_module_mapping()["disclaimer"]


# ══════════════════════════════════════════════════════════════════════
# select_next_question — 규칙 기반 다음 질문 선택
# ══════════════════════════════════════════════════════════════════════

def test_select_next_question_returns_single_question():
    q = cs.select_next_question(asked_question_ids=set())
    assert q is not None
    assert isinstance(q["question_id"], str)


def test_select_next_question_none_when_all_asked():
    all_ids = {q["question_id"] for q in cs.load_question_bank()}
    assert cs.select_next_question(asked_question_ids=all_ids) is None


def test_select_next_question_prefers_low_confidence_dimension():
    q = cs.select_next_question(
        asked_question_ids=set(),
        evidence_count={"interest.social": 5},
        confidence={"interest.social": 90},
    )
    # interest.social은 이미 근거 충분 → 근거가 부족한 다른 축을 우선해야 함
    assert "interest.social" not in q["target_dimensions"]


def test_select_next_question_blocks_third_consecutive_same_axis():
    q = cs.select_next_question(
        asked_question_ids=set(),
        recent_target_groups=["interest", "interest"],
    )
    assert q is not None
    group = q["target_dimensions"][0].split(".")[0] if q["target_dimensions"] else None
    assert group != "interest"


def test_select_next_question_prioritizes_conflicted_dimension():
    q = cs.select_next_question(
        asked_question_ids=set(),
        conflicted_dimensions={"constraint.high_social_contact"},
    )
    assert "constraint.high_social_contact" in q["target_dimensions"]


# ══════════════════════════════════════════════════════════════════════
# evaluate_gate — 추천 게이트(목표 상태, 라이브 게이트 대체 아님)
# ══════════════════════════════════════════════════════════════════════

def _passing_profile() -> dict:
    return {
        "purpose_confirmed": True,
        "interest_evidence_count": 3,
        "work_style_evidence_count": 3,
        "top_work_values_confirmed": True,
        "constraints_confirmed": True,
        "min_independent_evidence_per_top_module": 2,
        "user_interim_summary_confirmed": True,
        "key_contradictions_resolved": True,
    }


def test_gate_passes_when_all_conditions_met():
    result = cs.evaluate_gate(_passing_profile())
    assert result["passed"] is True
    assert result["missing_conditions"] == []


def test_gate_blocks_without_interim_summary_confirmation():
    profile = _passing_profile()
    profile["user_interim_summary_confirmed"] = False
    result = cs.evaluate_gate(profile)
    assert result["passed"] is False
    assert "user_interim_summary_confirmed" in result["missing_conditions"]


def test_gate_blocks_on_empty_profile():
    result = cs.evaluate_gate({})
    assert result["passed"] is False
    assert len(result["missing_conditions"]) > 0


# ══════════════════════════════════════════════════════════════════════
# map_to_modules — 실제 대표미션 ID만 조회 (새 mission_id 생성 없음)
# ══════════════════════════════════════════════════════════════════════

def test_map_to_modules_only_uses_real_mission_codes():
    real_codes = {m["mission_code"] for m in cs.load_module_mapping()["representative_missions"]}
    top = cs.map_to_modules({"interest.social": 90, "work_target.people": 80}, top_n=3)
    assert len(top) == 3
    for entry in top:
        for code in entry["representative_mission_codes"]:
            assert code in real_codes


def test_map_to_modules_ranks_social_interest_toward_person_facing_module():
    top = cs.map_to_modules({"interest.social": 100, "work_target.people": 100}, top_n=1)
    assert top[0]["module"] == "대인응대형"


# ══════════════════════════════════════════════════════════════════════
# 금지 표현 점검
# ══════════════════════════════════════════════════════════════════════

def test_forbidden_phrase_detected():
    hits = cs.check_forbidden_phrases("검사 결과 당신은 ISTJ입니다")
    assert "SF-001" in hits


def test_safe_phrase_not_flagged():
    hits = cs.check_forbidden_phrases("지금까지 나눈 대화를 보면 이런 성향일 가능성이 있어 보여요")
    assert hits == []


def test_build_safety_notes_nonempty_string():
    notes = cs.build_safety_notes()
    assert isinstance(notes, str)
    assert notes.strip()


# ══════════════════════════════════════════════════════════════════════
# §18 품질 검수 시나리오 — 데이터/규칙 설계가 각 시나리오를 지원하는지 검증
# (새 LLM 추출 파이프라인을 만들지 않으므로, 여기서는 그 판단을 뒷받침하는
#  데이터 구조·순수 함수 동작을 검증한다)
# ══════════════════════════════════════════════════════════════════════

def test_scenario1_error_detection_is_separate_from_structured_style():
    # "프로젝트에서 오류를 찾아 정리하는 게 재미있었어요"
    # → skill.error_detection 근거 + work_style.detail_orientation 후보, 둘은 별도 축
    assert cs.get_dimension("skill.error_detection") is not None
    assert cs.get_dimension("work_style.detail_orientation") is not None
    assert "skill.error_detection" != "work_style.detail_orientation"


def test_scenario2_social_interest_and_high_social_contact_are_separate_axes():
    # "사람 도와주는 건 좋은데 계속 대화하는 건 피곤해요"
    # → interest.social(긍정)과 constraint.high_social_contact(부정)는 서로 다른 축이라
    #   한쪽 긍정이 다른 쪽을 지우지 않는다.
    social = cs.get_dimension("interest.social")
    contact = cs.get_dimension("constraint.high_social_contact")
    assert social is not None and contact is not None
    assert social["dimension_code"] != contact["dimension_code"]
    # 충돌 상태를 넘기면 해당 제약 축을 우선 질문해야 함
    q = cs.select_next_question(asked_question_ids=set(), conflicted_dimensions={contact["dimension_code"]})
    assert contact["dimension_code"] in q["target_dimensions"]


def test_scenario3_skill_and_interest_kept_separate_gate_requires_both():
    # "엑셀은 잘하는데 하루 종일 표만 보는 건 싫어요"
    # → skill.tool_operation(능력)과 interest.conventional(흥미)는 분리 저장되어야 하고,
    #   능력 근거만으로는 게이트를 통과시키지 않는다(흥미/업무방식 근거도 별도로 요구).
    tool = cs.get_dimension("skill.tool_operation")
    assert any("싫" in ex or "표만" in ex for ex in tool["ambiguous_examples"])
    profile = _passing_profile()
    profile["interest_evidence_count"] = 0  # 능력 근거만 있고 흥미 근거가 없는 상태
    result = cs.evaluate_gate(profile)
    assert result["passed"] is False


def test_scenario4_vague_answer_triggers_low_confidence_followup():
    # "그냥 다 괜찮은 것 같아요" → 낮은 신뢰도 → 구체적 경험 질문으로 유도
    q = cs.select_next_question(
        asked_question_ids=set(),
        confidence={"interest.realistic": 20, "interest.investigative": 20},
    )
    assert q["question_id"] in {qq["question_id"] for qq in cs.load_question_bank()}
    ev = cs.load_evidence_rules()
    assert any("가정형" in p or "막연한" in p for p in ev["principles"])


def test_scenario5_night_shift_is_hard_constraint_not_preference():
    # "건강 때문에 야간근무는 할 수 없어요" → 제약(constraint)이지 선호가 아님
    dim = cs.get_dimension("constraint.night_shift")
    assert any("제약" in p for p in dim["prohibited_inferences"])


def test_scenario6_leadership_claim_requires_behavior_example():
    # "저는 리더십이 좋은 것 같아요" → 즉시 확정하지 않고 실제 행동 사례를 요구
    dim = cs.get_dimension("interest.enterprising")
    assert any("리더십" in ex for ex in dim["ambiguous_examples"])
    rule = next(
        r for r in cs.load_evidence_rules()["rules"] if r["source_type"] == "conversation_explicit"
    )
    assert "behavior_example" in rule["required_elements"]


def test_scenario7_anger_specific_dislike_does_not_blanket_negate_social_interest():
    # "사람 상대가 싫은 게 아니라 화난 사람을 상대하는 게 힘든 거예요"
    # → 특정 상황(감정노동)에 대한 부담이지, 대인 흥미 전체를 부정하는 게 아님
    dim = cs.get_dimension("constraint.high_social_contact")
    assert any("화난 사람" in ex for ex in dim["ambiguous_examples"])
    assert any("전체" in p or "확대" in p for p in dim["prohibited_inferences"])
