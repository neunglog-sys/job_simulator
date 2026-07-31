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
import re
import struct
import time
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


async def _elevenlabs_mp3(text: str, voice: str | None = None) -> bytes:
    """ElevenLabs TTS — 단일 연속 스트림 mp3 (gTTS식 조각 이음매 팝 없음).

    voice는 ElevenLabs voice_id. 미지정 시 설정값 사용. 한국어는 multilingual/flash 모델이 처리.
    """
    import httpx

    voice_id = voice or settings.elevenlabs_voice_id
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            url,
            headers={"xi-api-key": settings.elevenlabs_api_key, "accept": "audio/mpeg"},
            params={"output_format": "mp3_44100_128"},
            json={"text": text, "model_id": settings.elevenlabs_model},
        )
        res.raise_for_status()
        return res.content


_MD_BOLD_RE = re.compile(r"\*{1,3}(.+?)\*{1,3}", re.S)
_MD_BULLET_RE = re.compile(r"^\s*[-*]\s+", re.M)
_MD_HEADING_RE = re.compile(r"^\s*#{1,6}\s*", re.M)


def strip_markdown(text: str) -> str:
    """읽어줄 텍스트에서 마크다운 기호를 제거한다.

    상담 프롬프트는 미해결 대응 형식에서 **굵은 라벨**을 의도적으로 쓴다(system.md).
    화면에서는 굵게 렌더하면 되지만, TTS에 원문을 그대로 넘기면 음성이 별표를
    문자로 읽거나 어색하게 끊긴다 — 합성 직전에 기호만 벗겨낸다(내용은 보존).
    """
    out = _MD_HEADING_RE.sub("", text)
    out = _MD_BULLET_RE.sub("", out)
    out = _MD_BOLD_RE.sub(r"\1", out)
    return out.replace("`", "").strip()


def _log_tts(provider: str, text: str, voice: str | None, t0: float, size: int) -> None:
    """어느 단계가 응답했는지 한 줄로 남긴다.

    폴백은 조용히 일어난다 — 쿼터가 걸리면 사용자는 그대로 gTTS 로봇 목소리를,
    최악엔 0.6초 비프음을 듣는데 로그만 봐서는 알 수 없었다. 품질 지표(WER·MCD)를
    잴 때도 어느 샘플이 폴백으로 합성됐는지 모르면 결과가 통째로 오염된다.

    chars는 **strip_markdown을 거친 뒤**의 길이다 — 실제로 ElevenLabs에 전송돼
    과금되는 문자수가 그것이라, 과금 집계에 그대로 쓸 수 있다.
    """
    logger.info(
        "[TTS] provider=%s chars=%d voice=%s elapsed_ms=%.0f bytes=%d",
        provider,
        len(text),
        voice or "-",
        (time.monotonic() - t0) * 1000,
        size,
    )


async def synthesize(text: str, voice: str | None = None) -> tuple[bytes, str]:
    """텍스트 → (오디오 바이트, media_type)."""
    t0 = time.monotonic()
    text = strip_markdown(text)
    # 팀 확정 TTS — 키 있으면 최우선 (gTTS 팝·과도한 쉼 없음)
    if settings.elevenlabs_api_key:
        try:
            audio = await _elevenlabs_mp3(text, voice)
            _log_tts("elevenlabs", text, voice or settings.elevenlabs_voice_id, t0, len(audio))
            return audio, "audio/mpeg"
        except Exception:  # noqa: BLE001 — 키 오류·쿼터·네트워크 등. 아래 폴백으로 연동 유지
            logger.warning("ElevenLabs 실패 → 다음 폴백(OpenAI/gTTS)", exc_info=True)

    if settings.openai_api_key:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        res = await client.audio.speech.create(
            model=settings.tts_model,
            voice=voice or settings.tts_voice,
            input=text,
        )
        _log_tts("openai", text, voice or settings.tts_voice, t0, len(res.content))
        return res.content, "audio/mpeg"

    # 임시 — ElevenLabs 키 확보 전까지 gTTS로 실제 한국어 발화를 낸다
    try:
        audio = await asyncio.to_thread(_gtts_mp3_sync, text)
        _log_tts("gtts", text, None, t0, len(audio))
        return audio, "audio/mpeg"
    except Exception:  # noqa: BLE001 — gTTS 미설치/네트워크 차단 등. 비프음으로라도 연동은 유지
        logger.warning("gTTS 실패 → 비프음 폴백 (아바타 립싱크 검증엔 부적합)", exc_info=True)
        beep = _mock_beep_wav()
        _log_tts("beep", text, None, t0, len(beep))
        return beep, "audio/wav"
