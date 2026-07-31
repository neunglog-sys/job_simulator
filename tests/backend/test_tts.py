"""TTS 전처리·계측 — 합성 직전에 무엇이 바뀌고 무엇이 기록되는가.

상담 프롬프트는 미해결 대응 형식에서 굵은 라벨을 의도적으로 쓴다. 화면은 굵게
렌더하면 되지만 음성은 별표를 읽어버리므로 합성 직전에 기호만 벗긴다.
여기에 폴백 단계 로깅이 얹혀 있어, 둘의 순서가 어긋나면 과금 집계가 틀어진다.
"""

import logging

import pytest

from app.domains.tts.service import _log_tts, strip_markdown, synthesize


def test_strip_markdown_keeps_content():
    assert strip_markdown("**막힌 지점:** 재고가 안 맞아요") == "막힌 지점: 재고가 안 맞아요"
    assert strip_markdown("### 오늘 할 일") == "오늘 할 일"
    assert strip_markdown("- 첫째 항목") == "첫째 항목"
    assert strip_markdown("`코드`") == "코드"


def test_strip_markdown_leaves_plain_text_alone():
    plain = "안녕하세요. 오늘 하루 잘 부탁드립니다."
    assert strip_markdown(plain) == plain


def test_strip_markdown_survives_unmatched_asterisk():
    # 짝이 안 맞는 별표까지 삼키면 텍스트가 조용히 사라진다 — 원문을 남긴다.
    assert "3*4" in strip_markdown("계산은 3*4 입니다")


@pytest.mark.asyncio(loop_scope="session")
async def test_logged_chars_are_post_strip(monkeypatch, caplog):
    """[TTS] chars는 **마크다운을 벗긴 뒤** 길이여야 한다.

    실제로 ElevenLabs에 전송돼 과금되는 문자수가 그것이다. 원문 길이를 찍으면
    별표 개수만큼 과금 집계가 부풀려진다.
    """
    sent = {}

    async def fake_elevenlabs(text, voice=None):
        sent["text"] = text
        return b"\x00" * 10

    monkeypatch.setattr("app.domains.tts.service._elevenlabs_mp3", fake_elevenlabs)
    monkeypatch.setattr("app.domains.tts.service.settings.elevenlabs_api_key", "test-key")

    raw = "**막힌 지점:** 재고 불일치"
    with caplog.at_level(logging.INFO, logger="app.domains.tts.service"):
        audio, media_type = await synthesize(raw)

    assert media_type == "audio/mpeg" and audio == b"\x00" * 10
    assert sent["text"] == "막힌 지점: 재고 불일치"  # 별표가 벗겨진 채로 전송

    line = next(r.getMessage() for r in caplog.records if "[TTS]" in r.getMessage())
    assert "provider=elevenlabs" in line
    assert f"chars={len(sent['text'])}" in line, f"원문 길이({len(raw)})가 찍히면 안 된다: {line}"


def test_log_tts_records_provider_for_fallback_filtering(caplog):
    # 품질 지표를 낼 때 폴백으로 합성된 샘플을 걸러내려면 provider가 남아야 한다.
    with caplog.at_level(logging.INFO, logger="app.domains.tts.service"):
        _log_tts("gtts", "안녕하세요", None, 0.0, 1234)
    line = next(r.getMessage() for r in caplog.records if "[TTS]" in r.getMessage())
    assert "provider=gtts" in line and "chars=5" in line and "bytes=1234" in line
