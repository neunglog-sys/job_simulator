"""consultation/survey — 사전 설문 스코어링·전환 대사 (룰 기반)."""

import pytest
from fastapi import HTTPException

from app.domains.consultation.survey import (
    _load,
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


# summary_label이 전부 '…것을 선호'로 끝난다. 조사를 그대로 이어 붙이면
# "…선호이고, …선호인 것 같아요"라는 비문이 설문 직후 첫 대사로 나간다(2026-07-28 발견).
def test_summary_and_avatar_lines_are_grammatical():
    profile = {"realistic": 90, "social": 70}
    summary = profile_summary(profile)
    opening = avatar_lines(profile)[0]
    for broken in ("선호이고", "선호인", "선호이"):
        assert broken not in summary, f"{summary!r}에 비문 {broken!r}"
        assert broken not in opening, f"{opening!r}에 비문 {broken!r}"
    assert "선호하고" in summary
    assert "선호하시는 것 같아요" in opening


def test_flat_profile_does_not_produce_broken_sentence():
    # 성향이 하나도 안 잡히면 요약 문구를 억지로 끼우지 않는다
    # (예전엔 "…드러나지 않음인 것 같아요"가 나갔다).
    opening = avatar_lines({})[0]
    assert "않음인" not in opening
    assert "뚜렷하게 드러나지는 않았어요" in opening


@pytest.mark.parametrize(
    "dim", ["realistic", "investigative", "artistic", "social", "enterprising", "conventional"]
)
def test_score_answers_normalizes_despite_uneven_item_coverage(dim):
    """일부 차원(특히 enterprising)은 전용 선택지가 있는 문항 수가 다른 차원보다 적어
    원점수 총합이 구조적으로 낮다. score_answers는 문항별 '해당 차원 최고 획득치' 합계 대비로
    정규화하므로, 매 문항에서 그 차원 점수가 가장 높은 선택지를 고른 사용자는 문항 노출 빈도와
    무관하게 100점에 도달해야 한다 — 이게 깨지면 문항 설계 편향이 점수에 그대로 새는 것."""
    items = _load()["items"]
    answers = {
        item["id"]: max(
            item["options"], key=lambda o: o.get("dimension_scores", {}).get(dim, 0)
        )["key"]
        for item in items
    }
    profile = score_answers(answers)
    assert profile[dim] == 100
