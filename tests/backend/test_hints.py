"""simulation/hints — 힌트 3단계(조언 카드)·돌발 퀘스트 발동 판정."""

from app.domains.simulation.hints import advice_card, should_fire_quest

TASK = {
    "prompt": "요구사항 정리서 제출",
    "criteria": ["목적 명확", "대상 정의", "조건 일치"],
    "pass_score": 70,
    "hints": {"warning": "지어내면 감점", "answer_guide": "①목적 ②대상 ③조건 순서로"},
}
SCORES = [
    {"criterion": "목적 명확", "score": 90, "comment": "좋음"},
    {"criterion": "대상 정의", "score": 40, "comment": "누가 대상인지 없음"},
    {"criterion": "조건 일치", "score": 55, "comment": "대화 내용과 다름"},
]


def test_level1_gives_single_weakest():
    card = advice_card(TASK, 1, SCORES, "전반 보완 필요")
    assert card["level"] == 1
    assert "대상 정의" in card["content"]  # 최저점 기준 1개만
    assert "조건 일치" not in card["content"]
    assert "지어내면 감점" in card["content"]  # warning 포함


def test_level2_lists_all_weak():
    card = advice_card(TASK, 2, SCORES, "전반 보완 필요")
    assert card["level"] == 2
    assert "대상 정의" in card["content"] and "조건 일치" in card["content"]
    assert "목적 명확" not in card["content"]  # 통과 기준은 제외


def test_level3_reveals_answer_but_requires_submission():
    card = advice_card(TASK, 3, SCORES, "")
    assert card["level"] == 3
    assert "①목적" in card["content"]
    assert "직접 작성해 다시 제출" in card["content"]


def test_level3_without_answer_guide_falls_back_to_criteria():
    task = {"criteria": ["A", "B"], "hints": {}}
    card = advice_card(task, 5, [], "")
    assert "1. A" in card["content"] and "2. B" in card["content"]


def test_float_scores_still_counted():
    # LLM이 스키마를 어기고 40.0(float)을 줘도 부족 기준으로 잡혀야 함
    scores = [{"criterion": "대상 정의", "score": 40.0, "comment": "없음"}]
    card = advice_card(TASK, 1, scores, "")
    assert "대상 정의" in card["content"]


def test_level2_empty_scores_never_blank_card():
    # 기준별 점수가 없어도 (총점만 미달) 빈 카드가 나가면 안 됨
    card = advice_card(TASK, 2, [], "")
    assert card["content"].strip()


def test_weak_threshold_follows_pass_score():
    # pass_score=90이면 85점도 "부족한 기준"으로 잡혀야 함
    task = {**TASK, "pass_score": 90}
    scores = [{"criterion": "목적 명확", "score": 85, "comment": "아깝다"}]
    card = advice_card(task, 1, scores, "")
    assert "목적 명확" in card["content"]


STEP_MID = {"id": "s2", "task": {"on_pass": "s3"}}
STEP_LAST = {"id": "s3", "task": {"on_pass": "__end__"}}


def test_quest_fires_on_probability():
    assert should_fire_quest(STEP_MID, "pending", roll=0.1)
    assert not should_fire_quest(STEP_MID, "pending", roll=0.9)


def test_quest_forced_on_terminal_step_entry():
    # 종착 스텝(on_pass=__end__) 진입 = 마지막 기회 → 강제 (배열 순서 무관)
    assert should_fire_quest(STEP_LAST, "pending", roll=0.99)


def test_quest_never_fires_twice():
    for status in ("active", "passed", "failed", "none"):
        assert not should_fire_quest(STEP_LAST, status, roll=0.0)
