from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_user, resolve_user
from app.domains.avatar import service
from app.models import User

router = APIRouter(prefix="/api/avatar", tags=["avatar"])


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: str | None = None  # 미지정 시 아바타에 딸린 목소리 → 서버 기본값
    # 어느 아바타로 말할지 — /status의 avatars[].id 중 하나("male"|"female").
    # 요청마다 받으므로 상담 시작 전에도, 상담 도중에도 자유롭게 바꿀 수 있다.
    # 미지정·미지원 id면 기본 아바타로 진행한다(선택 UI가 에셋보다 먼저 나와도 안 깨짐).
    avatar_id: str | None = None


@router.get("/status")
async def status():
    """프론트가 아바타 사용 가능 여부를 미리 확인 (미설정이면 idle 영상만 재생)."""
    if settings.avatar_musetalk_ws_url:
        provider = "musetalk"
    elif settings.avatar_fastapi_url:
        provider = "fastapi"
    else:
        provider = "gradio"
    return {
        "enabled": bool(
            settings.avatar_musetalk_ws_url
            or settings.avatar_fastapi_url
            or settings.avatar_gradio_url
        ),
        "model_type": settings.avatar_model_type,
        "provider": provider,
        # 선택 UI가 고를 수 있는 아바타 목록. image_present는 백엔드 로컬 파일 유무일 뿐이라
        # (fastapi/musetalk provider는 provider 쪽 이미지 사용) 이 값으로 선택지를 숨기지 말 것.
        # 표시 이름·썸네일은 프론트/팀이 정한다.
        "avatars": service.available_avatars(),
        "default_avatar_id": service.DEFAULT_AVATAR_ID,
    }


@router.post("/speak")
async def speak(body: SpeakIn, user: User = Depends(get_current_user)):
    """발화 텍스트 → 아바타 연속 스트림 URL.

    응답: {"hls_url": "http://…/api/avatar/stream/<id>", "model_type": "lite"}
    (`hls_url` 이름은 프론트 호환 유지용. 실제로는 연속 fragmented MP4 스트림 URL이다.)

    백엔드가 Colab의 조각난 HLS를 ffmpeg로 **하나의 연속 fragmented MP4**로 재인코딩하고,
    프론트는 이 URL을 `<video src>`로 **네이티브 프로그레시브 재생**한다(hls.js 불필요).
    """
    return await service.speak(body.text, body.voice, body.avatar_id)


@router.post("/speak-chunks")
async def speak_chunks(body: SpeakIn, user: User = Depends(get_current_user)):
    """긴 발화 텍스트를 문장 단위로 나눠 스트림 URL을 SSE로 순차 전달.

    이벤트:
    - `plan`: `{total, chunks}`
    - `chunk`: `{index, total, text, hls_url, model_type, elapsed_ms}`
    - `done`: `{total}`
    - `error`: `{index, detail}`
    """
    return EventSourceResponse(
        service.speak_chunk_events(body.text, body.voice, body.avatar_id)
    )


@router.post("/warmup")
async def warmup():
    """MuseTalk 콜드스타트 예열 — 랜딩/로그인 등 진입점에서 더미 발화 1회 트리거.

    인증 없음(랜딩은 로그인 전). 여러 진입점에서 중복 호출돼도 서버가 **dedup**한다:
    이미 예열 중이거나 최근에 끝났으면 no-op(status: already_warming / recently_warmed).
    무거운 UNet+ffmpeg가 중복 실행되지 않도록 보호.
    """
    return await service.warmup_musetalk()


@router.websocket("/ws")
async def avatar_ws(
    websocket: WebSocket,
    token: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """프론트 WS ↔ 코랩 MuseTalk WS 투명 릴레이.

    - 인증: 브라우저 WS는 헤더를 못 실으므로 **쿼리 토큰**(`?token=`)으로 검증(HTTP와 동일 정책).
    - 프론트가 발화 요청(JSON)을 올리면 그대로 코랩에 전달, 코랩의 status(JSON)+fMP4 프레임(바이너리)을
      그대로 프론트에 내린다. 프론트는 바이너리를 MediaSource로 append해 스트리밍 재생.
    """
    await websocket.accept()
    try:
        await resolve_user(session, token=token)
    except HTTPException:
        await websocket.close(code=1008, reason="인증 실패")
        return
    await service.relay_musetalk_ws(websocket)


@router.get("/fastapi-stream/{stream_id}")
async def fastapi_stream(stream_id: str):
    """Colab FastAPI(ngrok)의 `/stream/<id>`를 같은 origin으로 프록시.

    브라우저 `<video src>`가 ngrok URL을 직접 열면 interstitial(HTML) → CORB 차단.
    백엔드가 `ngrok-skip-browser-warning` 헤더를 달아 대신 받아 video/mp4로 흘려보낸다.
    인증 없음: `<video src>`가 Authorization을 못 실음(`stream_id`는 추측 불가 임의값).
    """
    return StreamingResponse(
        service.proxy_fastapi_stream(stream_id), media_type="video/mp4"
    )


@router.get("/stream/{stream_id}")
async def avatar_stream(stream_id: str):
    """연속 fragmented MP4 스트림 — 브라우저 `<video>`가 프로그레시브로 재생.

    자라는 MP4 파일을 청크로 흘려보낸다(ffmpeg가 생성 중이면 새 데이터 대기, 완료되면 종료).
    인증 없음: `<video src>`가 Authorization 헤더를 못 실어서. `stream_id`는 임의 uuid라
    사실상 추측 불가하고, 스트림은 짧은 수명(끝나면 정리)이라 노출 위험 낮음.
    """
    return StreamingResponse(service.stream_mp4(stream_id), media_type="video/mp4")
