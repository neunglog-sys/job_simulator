from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.deps import get_current_user
from app.domains.avatar import service
from app.models import User

router = APIRouter(prefix="/api/avatar", tags=["avatar"])


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: str | None = None  # 미지정 시 서버 기본값


@router.get("/status")
async def status():
    """프론트가 아바타 사용 가능 여부를 미리 확인 (미설정이면 idle 영상만 재생)."""
    return {
        "enabled": bool(settings.avatar_gradio_url),
        "model_type": settings.avatar_model_type,
    }


@router.post("/speak")
async def speak(body: SpeakIn, user: User = Depends(get_current_user)):
    """발화 텍스트 → 아바타 HLS 스트림 URL.

    응답: {"hls_url": "https://…/gradio_api/stream/…/playlist.m3u8", "model_type": "lite"}

    프론트는 이 URL을 **hls.js로 재생**한다(Chrome/Firefox는 HLS 네이티브 미지원).
    영상 세그먼트는 브라우저가 Colab에서 직접 받아가므로 **백엔드를 거치지 않는다**.
    첫 세그먼트는 실측 1.8~2.0초 뒤 재생 시작 (+ TTS 시간).
    """
    return await service.speak(body.text, body.voice)
