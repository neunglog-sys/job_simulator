"""사수 브리핑 — 업무 시작 전에 알려주는 절차(1·3단계 '대화로 익힘'의 재료).

정답 키(answer)와는 구분된다: 절차는 말로 알려주고, 보기는 섞여 내려가므로 들은 절차를
보기와 맞추는 건 사용자 몫이다. 브리핑이 없으면 사용자는 아무것도 모른 채 퀴즈를 만난다.
"""

import pytest

from app.core.config import settings
from app.domains.simulation import state_machine as sm


@pytest.fixture(autouse=True)
def _gated(monkeypatch):
    monkeypatch.setattr(settings, "expose_answers", False)


def _step(answer_guide=None):
    return {
        "id": "m1",
        "title": "정상업무",
        "mission": "김세라: PR 1차 리뷰해줘",
        "npcs": ["npc_yg-03_02"],
        "task": {
            "kind": "checklist",
            "prompt": "필요한 행동을 모두 고르세요",
            "criteria": ["빠짐없이 골랐는가"],
            "options": [{"key": "a", "label": "A"}],
            "answer": {"keys": ["a"]},
            "hints": {"answer_guide": answer_guide} if answer_guide else {},
        },
    }


def test_briefing_splits_numbered_process():
    step = _step("① 개발 가이드를 확인한다 ② API 명세와 대조한다 ③ 근거를 붙여 코멘트한다")
    assert sm.briefing_steps(step) == [
        "개발 가이드를 확인한다",
        "API 명세와 대조한다",
        "근거를 붙여 코멘트한다",
    ]


def test_briefing_empty_when_no_guide():
    assert sm.briefing_steps(_step()) == []
    assert sm.briefing_steps({"id": "m1"}) == []  # task 자체가 없는 스텝


def test_briefing_single_item_without_marks():
    assert sm.briefing_steps(_step("체크리스트대로 점검한다")) == ["체크리스트대로 점검한다"]


def test_public_step_carries_briefing_but_not_answer():
    # 절차는 알려주되 정답 키는 여전히 숨긴다 — 이 둘이 함께 나가면 게이트가 무의미해진다
    out = sm.public_step(_step("① 확인한다 ② 대조한다"))
    assert out["briefing"] == ["확인한다", "대조한다"]
    assert "answer" not in out["task"]
