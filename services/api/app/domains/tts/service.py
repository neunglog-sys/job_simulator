"""TTS 프록시 — 아바타 발화 텍스트를 음성으로 (설계서 §4 Backend & API Gateway의 TTS).

OPENAI_API_KEY가 있으면 OpenAI TTS(mp3), 없으면 mock 비프음(wav)으로 폴백해
프론트가 키 없이도 오디오 재생 연동을 개발할 수 있다.
"""

import io
import logging
import math
import struct
import wave

from app.core.config import settings

logger = logging.getLogger(__name__)


def _mock_beep_wav(duration_sec: float = 0.6, freq: float = 440.0) -> bytes:
    """키 없는 개발용 비프음 WAV 생성 (외부 의존성 없음)."""
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


async def synthesize(text: str, voice: str | None = None) -> tuple[bytes, str]:
    """텍스트 → (오디오 바이트, media_type)."""
    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY 없음 → TTS mock(비프음) 반환")
        return _mock_beep_wav(), "audio/wav"

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    res = await client.audio.speech.create(
        model=settings.tts_model,
        voice=voice or settings.tts_voice,
        input=text,
    )
    return res.content, "audio/mpeg"
