"""TTS 프록시 — 아바타 발화 텍스트를 음성으로 (설계서 §4 Backend & API Gateway의 TTS).

폴백 순서: **OpenAI TTS(키 있으면) → gTTS(임시) → 비프음(최후)**

- **OpenAI**: `OPENAI_API_KEY`가 있을 때. mp3.
- **gTTS**: 키 없이 쓰는 **임시** 한국어 TTS. 품질은 로봇 같지만 아바타 립싱크를 실제
  발화 길이로 검증/시연할 수 있다. **팀 확정 TTS는 ElevenLabs** — 키가 확보되면 교체할 것.
- **비프음**: gTTS도 못 쓸 때(네트워크 차단 등). 오디오 연동 자체는 되게 하는 최후 폴백.
"""

import asyncio
import io
import logging
import math
import struct
import wave

from app.core.config import settings

logger = logging.getLogger(__name__)


def _mock_beep_wav(duration_sec: float = 0.6, freq: float = 440.0) -> bytes:
    """최후 폴백 — 개발용 비프음 WAV (외부 의존성 없음).

    ⚠️ 0.6초라 아바타 립싱크 검증엔 부적합(발화 길이가 비현실적).
    """
    rate = 16000
    n = int(rate * duration_sec)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(n)
        )
        w.writeframes(frames)
    return buf.getvalue()


def _gtts_mp3_sync(text: str) -> bytes:
    """gTTS 한국어 합성 (블로킹) — 구글에 네트워크 요청을 한다."""
    from gtts import gTTS

    buf = io.BytesIO()
    gTTS(text, lang="ko").write_to_fp(buf)
    return buf.getvalue()


async def synthesize(text: str, voice: str | None = None) -> tuple[bytes, str]:
    """텍스트 → (오디오 바이트, media_type)."""
    if settings.openai_api_key:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        res = await client.audio.speech.create(
            model=settings.tts_model,
            voice=voice or settings.tts_voice,
            input=text,
        )
        return res.content, "audio/mpeg"

    # 임시 — ElevenLabs 키 확보 전까지 gTTS로 실제 한국어 발화를 낸다
    try:
        audio = await asyncio.to_thread(_gtts_mp3_sync, text)
        logger.info("TTS: OPENAI_API_KEY 없음 → gTTS(임시) 사용")
        return audio, "audio/mpeg"
    except Exception:  # noqa: BLE001 — gTTS 미설치/네트워크 차단 등. 비프음으로라도 연동은 유지
        logger.warning("gTTS 실패 → 비프음 폴백 (아바타 립싱크 검증엔 부적합)", exc_info=True)
        return _mock_beep_wav(), "audio/wav"
