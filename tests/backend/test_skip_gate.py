"""미션 스킵 게이트 — 기본 차단, allow_skip_step=true일 때만 허용.

왜 중요한가: skip_step은 채점을 건너뛰고 미션을 통과 처리한다. 마지막 미션이면 완주로
기록되고 finalize_score까지 돌아 **안 푼 판이 점수·백분위 풀에 들어간다.** 정답 노출을
막은 것과 같은 이유로 시연·운영에서는 닫혀 있어야 한다([test_answer_gate.py] 참고).

프론트 버튼을 숨기는 것만으로는 부족하다 — WS로 `{"type": "skip_step"}`을 직접 보내면
그만이라, 서버가 거부해야 실제로 막힌다. 여기서는 그 서버 거부와, 프론트가 버튼을 숨길
근거로 쓰는 payload 플래그가 설정과 어긋나지 않는지를 고정한다.
"""

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.domains.simulation import service


class _Sim:
    """skip_step이 게이트에서 바로 튕기는지 보기 위한 최소 더미.

    게이트가 열려 있으면 _ensure_active → state 접근으로 넘어가므로, 게이트가 먼저
    걸리는지만 보려면 이 정도로 충분하다.
    """

    status = "active"
    state: dict = {}


@pytest.mark.asyncio(loop_scope="session")
async def test_skip_rejected_by_default(monkeypatch):
    monkeypatch.setattr(settings, "allow_skip_step", False)
    with pytest.raises(HTTPException) as exc:
        await service.skip_step(None, _Sim(), None)
    assert exc.value.status_code == 403
    assert "스킵" in exc.value.detail


@pytest.mark.asyncio(loop_scope="session")
async def test_gate_runs_before_anything_else(monkeypatch):
    """거부가 세션·시나리오를 건드리기 전에 일어나야 한다 — None을 넘겨도 403이어야 한다."""
    monkeypatch.setattr(settings, "allow_skip_step", False)
    with pytest.raises(HTTPException) as exc:
        await service.skip_step(None, _Sim(), None)
    assert exc.value.status_code == 403, "게이트보다 먼저 다른 코드가 돌아 다른 예외가 났다"


@pytest.mark.asyncio(loop_scope="session")
async def test_gate_opens_when_enabled(monkeypatch):
    """켜면 게이트를 통과한다 — 그 뒤 단계에서 나는 오류는 게이트 문제가 아니다."""
    monkeypatch.setattr(settings, "allow_skip_step", True)
    with pytest.raises(Exception) as exc:
        await service.skip_step(None, _Sim(), None)
    assert not (
        isinstance(exc.value, HTTPException) and exc.value.status_code == 403
    ), "allow_skip_step=true인데도 403으로 막혔다"


def test_default_is_closed():
    """기본값이 열려 있으면 .env를 깜빡한 배포에서 그대로 노출된다."""
    assert type(settings).model_fields["allow_skip_step"].default is False
