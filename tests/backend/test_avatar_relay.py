"""아바타 MuseTalk WS 릴레이 — 업스트림이 죽었을 때 **실패 코드로 닫는지**.

배경(2026-07-28 시연 리허설): 프론트는 `!streamDone && code !== 1000`일 때만 폴백을 탄다.
릴레이가 종료 코드를 안 주면 스타렛이 1000(정상 종료)으로 닫아, 코랩이 프레임 한 장 못
내리고 죽어도 프론트는 정상 종료로 오인한다 → 아무 표시 없이 아바타가 멈춘다("벙어리").
그래서 "실패는 1011로 닫는다"가 프론트와의 계약이고, 여기서 그 계약을 고정한다.
"""

import asyncio

import pytest

from app.domains.avatar.service import _pump_bidirectional


class FakeUpstream:
    """코랩 WS 대역 — 정해진 메시지를 흘리고, 원하면 마지막에 끊긴 것처럼 터진다."""

    def __init__(self, messages: list, fail_at_end: bool = False):
        self._messages = list(messages)
        self._fail_at_end = fail_at_end
        self.drained = asyncio.Event()
        self.closed = False

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        try:
            for msg in self._messages:
                yield msg
            if self._fail_at_end:
                raise RuntimeError("코랩 연결 끊김")
        finally:
            # 업스트림이 끝나야 클라이언트 쪽 펌프도 풀어준다(둘 다 끝나야 gather가 반환).
            self.drained.set()

    async def send(self, _data) -> None:
        return None

    async def close(self) -> None:
        self.closed = True


class FakeClientWS:
    """브라우저 WS 대역 — 닫힘 인자를 그대로 기록해 계약을 검증한다."""

    def __init__(self, gate: asyncio.Event):
        self._gate = gate
        self.sent_bytes: list[bytes] = []
        self.sent_text: list[str] = []
        self.close_calls: list[tuple[int, str]] = []

    async def receive(self) -> dict:
        # 업스트림이 끝날 때까지 붙들었다가 끊긴 것으로 돌려준다.
        await self._gate.wait()
        return {"type": "websocket.disconnect"}

    async def send_bytes(self, data: bytes) -> None:
        self.sent_bytes.append(data)

    async def send_text(self, text: str) -> None:
        self.sent_text.append(text)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.close_calls.append((code, reason))


async def _run(messages: list, fail_at_end: bool = False) -> FakeClientWS:
    upstream = FakeUpstream(messages, fail_at_end=fail_at_end)
    client = FakeClientWS(upstream.drained)
    await asyncio.wait_for(_pump_bidirectional(client, upstream), timeout=5)
    return client


@pytest.mark.asyncio(loop_scope="session")
async def test_normal_stream_closes_cleanly():
    # 프레임을 내리고 정상 종료하면 1000 — 프론트가 폴백을 타면 안 된다.
    client = await _run([b"\x00fmp4", '{"type":"done"}'])
    assert client.sent_bytes == [b"\x00fmp4"]
    assert client.close_calls[0][0] == 1000


@pytest.mark.asyncio(loop_scope="session")
async def test_no_binary_closes_with_failure_code():
    # status 텍스트만 오고 프레임 없이 끝난 경우 = 시연에서 본 firstBinaryAt:null.
    client = await _run(['{"type":"status","stage":"tts"}'])
    code, reason = client.close_calls[0]
    assert code == 1011
    assert "시작 전" in reason


@pytest.mark.asyncio(loop_scope="session")
async def test_upstream_error_midstream_closes_with_failure_code():
    # 프레임이 좀 나온 뒤 끊겨도 정상 종료가 아니다 — 남은 발화가 통째로 사라진다.
    client = await _run([b"\x00fmp4"], fail_at_end=True)
    code, reason = client.close_calls[0]
    assert code == 1011
    assert "오류" in reason


# ── 다이얼(연결) 실패 경로 ──────────────────────────────────────
# 위 세 건은 '연결은 됐는데 그 뒤가 잘못된' 경우다. 연결 자체가 실패하면(코랩 미기동·URL
# 오타·핸드셰이크 거절) 펌프는 아예 시작하지 않으므로 펌프의 finally가 못 닫는다.
# 이 경로가 뚫려 있으면 브라우저엔 1006(비정상 종료)으로 떨어져, 프론트는 원인을 모른 채
# 폴백만 탄다. 다이얼 실패도 1011로 닫히는지 여기서 고정한다.


@pytest.mark.asyncio(loop_scope="session")
async def test_upstream_dial_failure_closes_with_failure_code(monkeypatch):
    from app.core.config import settings
    from app.domains.avatar.service import relay_musetalk_ws

    # 127.0.0.1:1 = 즉시 connection refused (열려 있을 수 없는 포트)
    monkeypatch.setattr(settings, "avatar_musetalk_ws_url", "ws://127.0.0.1:1/musetalk")
    client = FakeClientWS(asyncio.Event())
    await asyncio.wait_for(relay_musetalk_ws(client), timeout=20)
    assert client.close_calls, "다이얼 실패인데 닫지 않았다 — 브라우저엔 1006으로 떨어진다"
    code, reason = client.close_calls[0]
    assert code == 1011, f"다이얼 실패가 {code}로 닫힘 — 1011이어야 한다"
    assert reason


@pytest.mark.asyncio(loop_scope="session")
async def test_missing_upstream_url_closes_with_failure_code(monkeypatch):
    from app.core.config import settings
    from app.domains.avatar.service import relay_musetalk_ws

    monkeypatch.setattr(settings, "avatar_musetalk_ws_url", "   ")
    client = FakeClientWS(asyncio.Event())
    await asyncio.wait_for(relay_musetalk_ws(client), timeout=5)
    code, _ = client.close_calls[0]
    assert code == 1011
