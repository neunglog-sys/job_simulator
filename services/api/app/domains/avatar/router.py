from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
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
    """발화 텍스트 → 아바타 연속 스트림 URL.

    응답: {"hls_url": "http://…/api/avatar/stream/<id>", "model_type": "lite"}
    (`hls_url` 이름은 프론트 호환 유지용. 실제로는 연속 fragmented MP4 스트림 URL이다.)

    백엔드가 Colab의 조각난 HLS를 ffmpeg로 **하나의 연속 fragmented MP4**로 재인코딩하고,
    프론트는 이 URL을 `<video src>`로 **네이티브 프로그레시브 재생**한다(hls.js 불필요).
    """
    return await service.speak(body.text, body.voice)


@router.get("/stream/{stream_id}")
async def avatar_stream(stream_id: str):
    """연속 fragmented MP4 스트림 — 브라우저 `<video>`가 프로그레시브로 재생.

    자라는 MP4 파일을 청크로 흘려보낸다(ffmpeg가 생성 중이면 새 데이터 대기, 완료되면 종료).
    인증 없음: `<video src>`가 Authorization 헤더를 못 실어서. `stream_id`는 임의 uuid라
    사실상 추측 불가하고, 스트림은 짧은 수명(끝나면 정리)이라 노출 위험 낮음.
    """
    return StreamingResponse(service.stream_mp4(stream_id), media_type="video/mp4")
