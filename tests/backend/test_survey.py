"""consultation/survey — 사전 설문 스코어링·전환 대사 (룰 기반)."""

import pytest
from fastapi import HTTPException

from app.domains.consultation.survey import (
    avatar_lines,
    profile_summary,
    public_items,
    score_answers,
)


def _full_answers(option: str = "a") -> dict:
    return {item["id"]: option for item in public_items()}


def test_public_items_hide_dimension_scores():
    items = public_items()
    assert len(items) >= 5
    assert all("dimension_scores" not in o for item in items for o in item["options"])


def test_score_answers_full_profile():
    profile = score_answers(_full_answers("a"))
    assert profile["realistic"] > profile["investigative"]  # 전부 a(실행형) 선택
    assert all(0 <= v <= 100 for v in profile.values())


def test_missing_answer_rejected():
    answers = _full_answers()
    answers.popitem()
    with pytest.raises(HTTPException) as e:
        score_answers(answers)
    assert e.value.status_code == 400


def test_invalid_option_rejected():
    answers = _full_answers()
    answers[next(iter(answers))] = "z"
    with pytest.raises(HTTPException) as e:
        score_answers(answers)
    assert e.value.status_code == 400


def test_avatar_lines_follow_script():
    profile = score_answers(_full_answers("d"))  # 전부 대인·조력형
    lines = avatar_lines(profile)
    assert len(lines) == 3
    assert "맞게 이해한 걸까요" in lines[0]
    assert "사람을 돕고" in lines[0]  # 프로파일 요약 주입
    assert "체험" in lines[1]
    assert "조정해볼게요" in lines[2]


def test_profile_summary_top_two():
    summary = profile_summary({"realistic": 90, "social": 70, "artistic": 10})
    assert "실행" in summary and "소통" in summary
