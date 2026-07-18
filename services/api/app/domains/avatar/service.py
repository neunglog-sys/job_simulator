"""아바타 스트리밍 — 텍스트 → TTS → SoulX-FlashHead(Colab/Gradio) → HLS 재생목록 URL.

## 왜 이런 구조인가 (2026-07-17 실측 근거)

Colab에서 공식 `gradio_app_streaming.py`를 `share=True`로 띄우면 **모델 상주 + 청크 스트리밍**이
이미 구현돼 있어 warm 서버를 직접 만들 필요가 없다. 이 모듈은 그 서버의 API를 호출만 한다.

**핵심:** `gr.Video(streaming=True)`의 출력은 mp4가 아니라 **HLS 재생목록(.m3u8)** 이다.
- `gradio_client` 기본 동작은 결과를 *파일로 다운로드* → `/gradio_api/file=…` 접근 → **403**
- `download_files=False`로 두면 `{'video': {'path':…, 'url': 'https://…/gradio_api/stream/…/playlist.m3u8'}}`
  형태로 **URL만** 돌려준다. 그 URL은 200 OK(`application/vnd.apple.mpegurl`)로 바로 재생 가능.
- 스트리밍 중 나오는 출력들은 **전부 같은 playlist URL** (HLS가 같은 재생목록에 세그먼트를 덧붙임)
  → **첫 출력에서 URL을 얻는 즉시 프론트에 넘기면**, 이후 세그먼트는 브라우저가 알아서 당겨간다.
  즉 **영상 데이터가 백엔드를 거치지 않는다.**

실측(A100, Lite, 한국어 8.59초): 첫 세그먼트 **1.8~2.0초**, 이후 세그먼트 간격 1.2~1.5초
(세그먼트 1개 = 2.88초 분량이므로 생성이 재생보다 2.3배 빠름 = 끊김 없음).

⚠️ **서버 사전 워밍 필수:** Colab에서 서버를 띄운 뒤 더미 추론 1회를 돌려야 한다.
   안 하면 첫 요청이 `torch.compile` JIT 컴파일로 **246.9초** 걸린다(실측).
"""

import asyncio
import logging
import tempfile
import time
from pathlib import Path

from fastapi import HTTPException

from app.core.config import settings
from app.domains.tts import service as tts_service

logger = logging.getLogger(__name__)

# gradio_client.Client는 생성 시 서버와 핸드셰이크를 해서 비싸다 → URL별로 캐시.
_client = None
_client_url: str | None = None

# 첫 URL만 받고 반환해도 서버는 계속 생성한다. Job이 GC되며 취소되지 않도록 참조를 붙들어 둔다.
_active_jobs: set = set()


def _reap_jobs() -> None:
    for job in [j for j in _active_jobs if j.done()]:
        _active_jobs.discard(job)


def _get_client():
    global _client, _client_url
    from gradio_client import Client

    url = settings.avatar_gradio_url
    if _client is None or _client_url != url:
        # download_files=False가 핵심 — 없으면 HLS 스트림을 파일로 받으려다 403
        _client = Client(url, download_files=False, verbose=False)
        _client_url = url
        logger.info("아바타 Gradio 클라이언트 연결: %s", url)
    return _client


def _extract_url(out) -> str | None:
    """출력에서 HLS playlist URL을 뽑는다.

    정상: {'video': {'path': '…/playlist.m3u8', 'url': 'https://…/gradio_api/stream/…'}}
    실패 시 출력에 Exception 객체가 담겨 오므로 값의 실체를 확인해야 한다
    (예외 미발생 = 성공으로 착각했던 이력 있음).
    """
    if isinstance(out, Exception):
        raise out
    if isinstance(out, (list, tuple)):
        for item in out:
            if isinstance(item, Exception):
                raise item
        out = out[0] if out else None
    if isinstance(out, dict):
        video = out.get("video") or out
        if isinstance(video, dict):
            return video.get("url")
    return None


def _submit_sync(audio_path: str) -> str:
    """블로킹 호출 — 첫 HLS URL이 나오는 즉시 반환 (전체 생성 완료를 기다리지 않음)."""
    from gradio_client import handle_file

    _reap_jobs()
    client = _get_client()
    job = client.submit(
        settings.avatar_ckpt_dir,
        settings.avatar_wav2vec_dir,
        settings.avatar_model_type,
        handle_file(settings.avatar_image_path),
        handle_file(audio_path),
        settings.avatar_seed,
        settings.avatar_use_face_crop,
        api_name=settings.avatar_api_name,
    )
    _active_jobs.add(job)  # 반환 후에도 서버가 나머지 세그먼트를 계속 만들도록 참조 유지

    deadline = time.monotonic() + settings.avatar_timeout_ms / 1000
    while time.monotonic() < deadline:
        for out in job.outputs():
            url = _extract_url(out)
            if url:
                return url
        if job.done():
            break
        time.sleep(0.05)

    raise TimeoutError("아바타 스트림 URL을 시간 내에 받지 못함")


async def speak(text: str, voice: str | None = None) -> dict:
    """발화 텍스트 → HLS 스트림 URL. 프론트는 이 URL을 hls.js로 재생한다."""
    if not settings.avatar_gradio_url:
        # Colab 세션이 안 떠 있으면 여기로 — 프론트는 idle 영상 유지로 폴백
        raise HTTPException(
            status_code=503, detail="아바타 서버가 설정되지 않았어요 (AVATAR_GRADIO_URL)"
        )

    if not Path(settings.avatar_image_path).is_file():
        raise HTTPException(
            status_code=503,
            detail=f"아바타 이미지가 없어요: {settings.avatar_image_path}",
        )

    audio, media_type = await tts_service.synthesize(text, voice)
    suffix = ".mp3" if "mpeg" in media_type else ".wav"

    # gradio_client가 경로로 업로드하므로 파일로 떨궈야 한다 (delete=False → finally에서 정리)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio)
        audio_path = tmp.name
    try:
        t0 = time.monotonic()
        url = await asyncio.to_thread(_submit_sync, audio_path)
        logger.info("아바타 HLS URL 확보: %.2fs", time.monotonic() - t0)
        return {"hls_url": url, "model_type": settings.avatar_model_type}
    except TimeoutError as e:
        raise HTTPException(
            status_code=504, detail="아바타 생성이 지연되고 있어요. 잠시 후 다시 시도해주세요."
        ) from e
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — Colab 세션 만료/URL 변경 등 외부 장애를 프론트 규약으로 변환
        logger.exception("아바타 생성 실패")
        raise HTTPException(status_code=502, detail="아바타 서버와 통신하지 못했어요.") from e
    finally:
        Path(audio_path).unlink(missing_ok=True)
