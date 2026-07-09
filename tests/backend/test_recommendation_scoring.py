"""recommendation — 룰 기반 스코어링 (결정적 로직이라 단위 테스트 최적)."""

from types import SimpleNamespace

from app.domains.recommendation.service import (
    NEUTRAL_SCORE,
    _build_reason,
    _score_job,
)


def _job(competencies, title="테스트 직무"):
    return SimpleNamespace(competencies=competencies, title=title)


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


def test_build_reason_picks_top_competencies():
    job = _job({"communication": 5, "problem_solving": 1}, title="마케터")
    names = {"communication": "커뮤니케이션", "problem_solving": "문제해결력"}
    reason = _build_reason(job, {"communication": 90, "problem_solving": 90}, names)
    assert "커뮤니케이션" in reason
    assert "마케터" in reason
