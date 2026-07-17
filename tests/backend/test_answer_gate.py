"""과제 정답 노출 게이트 — 기본 차단, expose_answers=true일 때만 공개.

왜 중요한가: 정답이 클라이언트에 있으면 NPC 대화로 정보를 얻을 이유가 사라져 게임이
성립하지 않고(대화·맵·호감도가 전부 장식이 됨), 리포트의 점수·백분위도 무의미해진다.
"""

import pytest

from app.core.config import settings
from app.domains.simulation import state_machine as sm

_TASK = {
    "kind": "checklist",
    "prompt": "이 업무에 필요한 행동을 모두 고르세요",
    "criteria": ["필요한 행동을 빠짐없이 골랐는가"],
    "pass_score": 70,
    "options": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}],
    "answer": {"keys": ["a"]},
    "hints": {"answer_guide": "① A를 한다 ② B는 하지 않는다"},
}


@pytest.fixture
def gated(monkeypatch):
    monkeypatch.setattr(settings, "expose_answers", False)


@pytest.fixture
def exposed(monkeypatch):
    monkeypatch.setattr(settings, "expose_answers", True)


def test_answer_hidden_by_default(gated):
    out = sm.public_task(_TASK)
    assert "answer" not in out, "정답이 클라이언트로 나감 — 게임이 성립하지 않는다"
    assert "answer_guide" not in out


def test_playable_fields_survive_the_gate(gated):
    # 게이트가 과제 자체를 못 풀게 만들면 안 된다 — 보기·기준·프롬프트는 그대로.
    out = sm.public_task(_TASK)
    assert out["prompt"] and out["criteria"] and out["pass_score"] == 70
    assert [o["key"] for o in out["options"]] == ["a", "b"]
    assert all("label" in o for o in out["options"])


def test_answer_exposed_when_flag_on(exposed):
    out = sm.public_task(_TASK)
    assert out["answer"] == {"keys": ["a"]}
    assert out["answer_guide"].startswith("①")


def test_gate_applies_through_public_step(gated):
    step = {"id": "m1", "title": "t", "mission": "m", "npcs": ["n1"], "task": _TASK}
    task = sm.public_step(step)["task"]
    assert "answer" not in task and "answer_guide" not in task


def test_options_never_leak_answer_tags(gated):
    # 보기에는 key·label만 — 정답 태그(o/x 등) 원본 필드가 섞여 나가면 안 됨
    task = dict(_TASK, options=[{"key": "a", "label": "A", "tag": "o"}])
    out = sm.public_task(task)
    assert out["options"] == [{"key": "a", "label": "A"}]
