"""과제 채점기 — 합격선 근처에서 합불이 뒤집히지 않게 하는 장치.

## 왜 필요한가

같은 답안을 다시 내면 다른 점수가 나온다(0728 감사: 5회 재채점 sd 1.73, 9답안 중 2개가
합불이 갈림). 사용자는 왜 결과가 달라졌는지 알 방법이 없다.

온도와 사고 토큰을 껐지만 그것만으로는 안 잡힌다 — Gemini에 seed가 없어 원리적으로
비결정적이다(실측: 같은 답안 8회에 sd 3.5~4.2). 그래서 **합격선 근처에서만** 표본을
늘려 중앙값으로 판정한다. 해로운 건 95냐 100이냐가 아니라 합불이 갈리는 것이다.

여기서는 그 장치가 실제로 도는지를 고정한다. 실제 LLM은 부르지 않는다 — 점수가
흔들리는 상황을 손으로 만들어야 검증이 되기 때문이다.
"""

import pytest

from app.domains.scoring import service as scoring

TASK = {
    "kind": "write",
    "prompt": "확인 결과를 보고하세요.",
    "criteria": ["원인을 규명했는가", "미결 사항을 밝혔는가"],
    "pass_score": 70,
}


class _ScriptedLLM:
    """호출 순서대로 정해진 total을 돌려준다."""

    def __init__(self, totals):
        self._totals = list(totals)
        self.calls = 0

    async def chat_json(self, *_args, **_kwargs):
        self.calls += 1
        total = self._totals.pop(0) if self._totals else self._totals
        return {"scores": [], "total": total, "feedback": "테스트"}


@pytest.fixture
def stub(monkeypatch):
    def _install(totals):
        llm = _ScriptedLLM(totals)
        monkeypatch.setattr(scoring, "get_llm", lambda: llm)
        monkeypatch.setattr(scoring, "render_prompt", lambda *_a, **_k: "system")
        return llm

    return _install


@pytest.mark.asyncio(loop_scope="session")
async def test_boundary_uses_median_not_first_score(stub):
    """첫 채점이 통과여도 나머지 둘이 미달이면 미달로 판정한다 — 운 좋은 한 번을 막는다."""
    llm = stub([71, 66, 67])
    out = await scoring.evaluate_task("m", TASK, "", "제출물")
    assert llm.calls == scoring.BOUNDARY_SAMPLES
    assert out["total"] == 67, "중앙값이 아니라 다른 값을 썼다"
    assert out["passed"] is False


@pytest.mark.asyncio(loop_scope="session")
async def test_boundary_median_can_rescue_a_pass(stub):
    """반대로 첫 채점이 미달이어도 다수가 통과면 통과다 — 한쪽으로만 편향되면 안 된다."""
    stub([69, 72, 74])
    out = await scoring.evaluate_task("m", TASK, "", "제출물")
    assert out["total"] == 72
    assert out["passed"] is True


@pytest.mark.asyncio(loop_scope="session")
async def test_clear_pass_is_graded_once(stub):
    """명백한 통과는 한 번만 채점한다 — 밴드 밖까지 재채점하면 비용만 3배가 된다."""
    llm = stub([95])
    out = await scoring.evaluate_task("m", TASK, "", "제출물")
    assert llm.calls == 1
    assert out["total"] == 95 and out["passed"] is True


@pytest.mark.asyncio(loop_scope="session")
async def test_clear_fail_is_graded_once(stub):
    llm = stub([30])
    out = await scoring.evaluate_task("m", TASK, "", "제출물")
    assert llm.calls == 1
    assert out["passed"] is False


@pytest.mark.asyncio(loop_scope="session")
async def test_extra_sample_failure_does_not_block_grading(stub, monkeypatch):
    """추가 표본이 실패해도 채점은 끝나야 한다 — 재채점은 보조 장치지 필수가 아니다."""

    class _Flaky(_ScriptedLLM):
        async def chat_json(self, *args, **kwargs):
            self.calls += 1
            if self.calls > 1:
                raise RuntimeError("업스트림 오류")
            return {"scores": [], "total": 71, "feedback": "테스트"}

    llm = _Flaky([])
    monkeypatch.setattr(scoring, "get_llm", lambda: llm)
    monkeypatch.setattr(scoring, "render_prompt", lambda *_a, **_k: "system")
    out = await scoring.evaluate_task("m", TASK, "", "제출물")
    assert out["total"] == 71, "추가 표본 실패로 채점이 깨졌다"
    assert out["passed"] is True


@pytest.mark.asyncio(loop_scope="session")
async def test_grader_disables_temperature_and_thinking(monkeypatch):
    """채점기는 측정 도구다 — 무작위성을 끄고 부르는지 고정한다.

    temperature만 0으로 내려서는 안 잡힌다(실측 sd 3.78 → 3.81). Gemini는 사고 토큰이
    기본 활성이고 그 과정이 온도와 무관하게 흔들리므로 thinking_budget=0이 함께 필요하다.
    """
    seen: dict = {}

    class _Recorder:
        async def chat_json(self, *_args, **kwargs):
            seen.update(kwargs)
            return {"scores": [], "total": 95, "feedback": "테스트"}

    monkeypatch.setattr(scoring, "get_llm", lambda: _Recorder())
    monkeypatch.setattr(scoring, "render_prompt", lambda *_a, **_k: "system")
    await scoring.evaluate_task("m", TASK, "", "제출물")
    assert seen.get("temperature") == 0.0
    assert seen.get("thinking_budget") == 0
