from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.core.deps import get_current_user
from app.domains.tts import service
from app.models import User

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: str | None = None  # 미지정 시 서버 기본값


@router.post("")
async def synthesize(body: TtsIn, user: User = Depends(get_current_user)):
    """아바타 발화 텍스트 → 음성. 키 있으면 mp3, 없으면 개발용 비프음 wav."""
    audio, media_type = await service.synthesize(body.text, body.voice)
    return Response(content=audio, media_type=media_type)
