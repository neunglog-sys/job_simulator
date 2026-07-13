"""recommendation — 룰 기반 스코어링 (결정적 로직이라 단위 테스트 최적)."""

from types import SimpleNamespace

from app.domains.recommendation.service import (
    INTEREST_WEIGHT,
    NEUTRAL_SCORE,
    _build_reason,
    _interest_match,
    _score_job,
    is_recommendable,
)


def _job(competencies, title="테스트 직무", interest_profile=None):
    return SimpleNamespace(
        competencies=competencies, title=title, interest_profile=interest_profile or {}
    )


def test_weighted_average():
    # 가중치 5인 역량 100점, 가중치 1인 역량 0점 → 500/600 ≈ 83
    job = _job({"a": 5, "b": 1})
    assert _score_job(job, {"a": 100, "b": 0}) == 83


def test_all_max_scores():
    job = _job({"a": 3, "b": 2})
    assert _score_job(job, {"a": 100, "b": 100}) == 100


def test_missing_scores_use_neutral():
    job = _job({"a": 5})
    assert _score_job(job, {}) == NEUTRAL_SCORE


def test_empty_weights_neutral():
    assert _score_job(_job({}), {"a": 100}) == NEUTRAL_SCORE


def test_is_recommendable_excludes_empty_competency_jobs():
    # 게임 시나리오 전용 '플레이용' 직무(competencies:{})는 추천 후보가 아니어야 함
    assert is_recommendable(_job({"a": 5})) is True
    assert is_recommendable(_job({})) is False


def test_build_reason_picks_top_competencies():
    job = _job({"communication": 5, "problem_solving": 1}, title="마케터")
    names = {"communication": "커뮤니케이션", "problem_solving": "문제해결력"}
    reason = _build_reason(job, {"communication": 90, "problem_solving": 90}, names)
    assert "커뮤니케이션" in reason
    assert "마케터" in reason


# --- 흥미유형(RIASEC) 매칭 — 가중평균이 아닌 코사인 유사도를 쓰는 이유:
# 사용자가 관심 없는 유형에 0점을 준 것(정상 신호)이 가중평균에서는 직무의 다른 차원
# 가중치와 곱해져 전체 점수를 깎아버려, 주력 유형이 정확히 일치해도 점수가 낮게 나오는
# 문제가 실측으로 확인됐다 (j011 사례: 가중평균 43점 vs 코사인 유사도 88점대).


def test_interest_match_identical_direction_is_high():
    # 방향이 완전히 같으면(비율만 다름) 100에 가까워야 함
    job_profile = {"conventional": 5, "social": 2}
    user_profile = {"conventional": 100, "social": 40}
    assert _interest_match(job_profile, user_profile) == 100


def test_interest_match_not_dragged_down_by_irrelevant_zero_dims():
    # 사용자가 무관한 유형에 0점을 줘도(=관심 없다는 정상 신호), 주력 유형이 일치하면
    # 점수가 크게 깎이면 안 된다 — 이게 가중평균 대비 이번 수정의 핵심.
    job_profile = {"realistic": 2, "investigative": 2, "artistic": 1, "social": 2, "enterprising": 2, "conventional": 5}
    user_profile = {"realistic": 23, "investigative": 0, "artistic": 0, "social": 0, "enterprising": 31, "conventional": 100}
    score = _interest_match(job_profile, user_profile)
    assert score is not None and score >= 80


def test_interest_match_orthogonal_is_zero():
    job_profile = {"artistic": 5}
    user_profile = {"conventional": 100}
    assert _interest_match(job_profile, user_profile) == 0


def test_interest_match_none_when_job_has_no_profile():
    assert _interest_match({}, {"conventional": 100}) is None


def test_interest_match_none_when_user_has_no_profile():
    assert _interest_match({"conventional": 5}, {}) is None


def test_score_job_falls_back_to_competency_when_no_survey():
    job = _job({"a": 5}, interest_profile={"conventional": 5})
    assert _score_job(job, {"a": 100}, interest_profile=None) == 100


def test_score_job_falls_back_to_competency_when_job_has_no_interest_profile():
    # 레거시 직무(interest_profile 없음)는 흥미유형 매칭 없이 역량 점수만으로 평가되어야 함
    job = _job({"a": 5}, interest_profile={})
    assert _score_job(job, {"a": 100}, interest_profile={"conventional": 100}) == 100


def test_score_job_blends_competency_and_interest():
    job = _job({"a": 5}, interest_profile={"conventional": 5})
    # competency=100, interest(코사인 동일 방향)=100 → blend해도 100
    assert _score_job(job, {"a": 100}, interest_profile={"conventional": 100}) == 100
    # 흥미유형이 정반대(직교)면 30% 비중만큼 깎여야 함
    score = _score_job(job, {"a": 100}, interest_profile={"artistic": 100})
    assert score == round(100 * (1 - INTEREST_WEIGHT))


def test_build_reason_adds_interest_bonus_when_dominant_dim_matches():
    job = _job(
        {"task_management": 5},
        title="구매사무 보조",
        interest_profile={"conventional": 5, "artistic": 1},
    )
    names = {"task_management": "업무 관리"}
    reason = _build_reason(
        job, {"task_management": 90}, names, interest_profile={"conventional": 80}
    )
    assert "체계·관리형" in reason


def test_build_reason_no_interest_bonus_when_user_score_below_threshold():
    job = _job(
        {"task_management": 5},
        title="구매사무 보조",
        interest_profile={"conventional": 5, "artistic": 1},
    )
    names = {"task_management": "업무 관리"}
    reason = _build_reason(
        job, {"task_management": 90}, names, interest_profile={"conventional": 30}
    )
    assert "성향과도 잘 맞아요" not in reason


def test_build_reason_no_interest_bonus_when_job_top_weight_below_threshold():
    job = _job(
        {"task_management": 5},
        title="구매사무 보조",
        interest_profile={"conventional": 3, "artistic": 1},
    )
    names = {"task_management": "업무 관리"}
    reason = _build_reason(
        job, {"task_management": 90}, names, interest_profile={"conventional": 90}
    )
    assert "성향과도 잘 맞아요" not in reason
