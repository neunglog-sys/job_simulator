"""추천근거 개인화 — 그라운딩 게이트·신뢰도·직무 매칭 단위 검증.

핵심은 그라운딩 게이트가 **날조 인용을 실제로 떨어뜨리는지**(실패 경로 강제)와 신뢰도가
evidence_rules.json 수식과 **결정론적으로 일치**하는지다. 전부 LLM 없이 검증한다.
"""

from app.domains.recommendation.evidence import (
    EvidenceItem,
    _dimensions,
    _evidence_rules,
    _ground_quote,
    _job_relevance,
    _score_confidence,
    _valid_dimension_codes,
    attach_to_recommendations,
)
from app.llm.prompts import render_prompt
from app.models import Job

USER_TEXT = "저는 숫자 오류를 잘 찾아내는 편이에요. 팀원이 놓친 걸 제가 먼저 발견한 적도 있어요."


# ── 그라운딩 게이트 (날조 차단 = 최우선 검증) ──────────────────────────────
def test_ground_quote_accepts_real_substring():
    assert _ground_quote("숫자 오류를 잘 찾아내는", USER_TEXT) is True


def test_ground_quote_rejects_hallucinated():
    # 사용자가 하지 않은 말 — 반드시 폐기되어야 한다.
    assert _ground_quote("저는 데이터 분석 자격증이 있어요", USER_TEXT) is False


def test_ground_quote_rejects_paraphrase():
    # 뜻은 같아도 원문과 글자가 다르면(요약·의역) 폐기 — verbatim만 허용.
    assert _ground_quote("오류를 잘 찾습니다", USER_TEXT) is False


def test_ground_quote_rejects_too_short():
    # "숫자 오류"는 실제 부분문자열이지만 8자 미만이라 우연 매칭 방지로 폐기.
    assert "숫자 오류" in USER_TEXT
    assert _ground_quote("숫자 오류", USER_TEXT) is False


def test_ground_quote_whitespace_normalized():
    assert _ground_quote("숫자   오류를  잘 찾아내는", USER_TEXT) is True


def test_ground_quote_empty():
    assert _ground_quote("", USER_TEXT) is False
    assert _ground_quote("아무말이나 길게", "") is False


# ── 신뢰도 (evidence_rules.json 수식과 결정론적 일치) ──────────────────────
def _flags(**over) -> dict:
    base = dict(
        has_behavior_example=True, reason_included=False,
        specific_outcome_included=False, hypothetical_phrasing=False,
        single_word_answer=False,
    )
    base.update(over)
    return base


def test_confidence_explicit_base():
    # conversation_explicit base=60, 보너스/페널티 없음.
    assert _score_confidence("conversation_explicit", _flags()) == 60


def test_confidence_explicit_full_bonus():
    # 60 +15(reason) +10(outcome) = 85.
    assert _score_confidence(
        "conversation_explicit",
        _flags(reason_included=True, specific_outcome_included=True),
    ) == 85


def test_confidence_explicit_penalty():
    # 60 -20(hypothetical) -15(single_word) = 25.
    assert _score_confidence(
        "conversation_explicit",
        _flags(hypothetical_phrasing=True, single_word_answer=True),
    ) == 25


def test_confidence_explicit_without_behavior_downgrades():
    # explicit인데 behavior_example 없음 → inferred(base 30)로 강등 + vague(-10) = 20.
    assert _score_confidence(
        "conversation_explicit", _flags(has_behavior_example=False)
    ) == 20


def test_confidence_inferred_with_behavior():
    # inferred base=30, vague_self_assessment 미해당(behavior 있음) → 30.
    assert _score_confidence("conversation_inferred", _flags()) == 30


def test_confidence_clamped_range():
    # 어떤 플래그 조합이든 0~100 범위.
    for st in ("conversation_explicit", "conversation_inferred"):
        for combo in range(32):
            f = _flags(
                has_behavior_example=bool(combo & 1),
                reason_included=bool(combo & 2),
                specific_outcome_included=bool(combo & 4),
                hypothetical_phrasing=bool(combo & 8),
                single_word_answer=bool(combo & 16),
            )
            assert 0 <= _score_confidence(st, f) <= 100


# ── 직무 매칭 (관련도·재사용 금지·생략) ────────────────────────────────────
def _item(code, conf, quote):
    return EvidenceItem(dimension_code=code, quote=quote, value="v",
                        source_type="conversation_explicit", confidence=conf)


def test_job_relevance_dimension_weights_direct():
    job = Job(code="cat", dimension_weights={"interest.artistic": 5, "skill.communication": 3})
    assert _job_relevance(job, "interest.artistic") == 5.0
    assert _job_relevance(job, "skill.communication") == 3.0
    assert _job_relevance(job, "interest.realistic") is None


def test_job_relevance_interest_profile_riasec():
    job = Job(code="c", competencies={"communication": 4}, interest_profile={"artistic": 5})
    assert _job_relevance(job, "interest.artistic") == 5.0
    assert _job_relevance(job, "interest.social") is None  # profile에 없음


def test_job_relevance_skill_bridge():
    job = Job(code="c", competencies={"communication": 4, "problem_solving": 5})
    assert _job_relevance(job, "skill.communication") == 4.0
    assert _job_relevance(job, "skill.error_detection") == 5.0
    # 모호해서 브리지에 없는 skill은 competencies형 직무에 안 붙음.
    assert _job_relevance(job, "skill.tool_operation") is None


def test_attach_picks_best_and_never_reuses_quote():
    job_a = Job(code="A", dimension_weights={"interest.artistic": 5, "skill.communication": 3})
    job_b = Job(code="B", competencies={"communication": 4}, interest_profile={"artistic": 5})
    e_art = _item("interest.artistic", 85, "밤새 영상 편집을 해도 재밌었어요")
    e_comm = _item("skill.communication", 60, "낯선 사람한테 설명해서 잘 전달됐어요")
    out = attach_to_recommendations([job_a, job_b], [e_art, e_comm])
    # A는 관련도×신뢰도 최고인 artistic을 가져간다.
    assert out["A"]["quote"] == "밤새 영상 편집을 해도 재밌었어요"
    # B도 artistic이 관련되지만 이미 A가 썼으므로 재사용 금지 → communication으로.
    assert out["B"]["quote"] == "낯선 사람한테 설명해서 잘 전달됐어요"


def test_attach_omits_when_no_relevant_evidence():
    job = Job(code="X", competencies={"situation_judgment": 3})  # skill 브리지에 없는 역량만
    e_art = _item("interest.artistic", 85, "밤새 영상 편집을 해도 재밌었어요")
    out = attach_to_recommendations([job], [e_art])
    assert out["X"] is None  # 억지로 붙이지 않고 생략


def test_attach_filters_below_surface_confidence():
    job = Job(code="A", dimension_weights={"interest.artistic": 5})
    weak = _item("interest.artistic", 30, "그냥 그런 것도 좋아하는 편이에요")  # < 60
    out = attach_to_recommendations([job], [weak])
    assert out["A"] is None  # 저장은 되지만 표면화는 안 됨


# ── 데이터팩·프롬프트 정합 ─────────────────────────────────────────────────
def test_dimension_codes_unique_and_nonempty():
    codes = [d["dimension_code"] for d in _dimensions()]
    assert len(codes) == len(set(codes))
    assert len(codes) >= 40


def test_evidence_rules_have_expected_source_types():
    types = {r["source_type"] for r in _evidence_rules()["rules"]}
    assert "conversation_explicit" in types
    assert "conversation_inferred" in types


def test_evidence_prompt_renders_all_dimensions():
    out = render_prompt("recommendation/evidence.md", dimensions=_dimensions())
    assert "글자 그대로 복사" in out
    assert "없는 축은 넣지 마세요" in out
    # 모든 축 코드가 프롬프트에 실제로 주입되는지.
    for code in _valid_dimension_codes():
        assert code in out
