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
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
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

# 연속 변환(ffmpeg) 프로세스 추적 — 끝났거나 오래된 것은 정리한다.
_transcodes: list[dict] = []
_TRANSCODE_MAX_AGE_S = 300


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


async def warmup() -> None:
    """앱 기동 시 Gradio Client를 미리 만들어 둔다 (핸드셰이크 ≈2.4초 선지불).

    `_get_client`는 첫 호출에서 서버와 config 핸드셰이크를 하느라 ~2.4초가 든다(실측).
    그대로 두면 그 비용을 **첫 사용자의 첫 발화**가 물게 된다. 기동 시 미리 붙여두면
    아무도 안 기다린다. (`docker compose up -d`가 .env의 최신 URL로 재기동하므로 여기서 붙는
    URL도 최신이다.)

    아바타 미설정(URL 없음)이거나 Colab 세션이 아직 안 떠 있으면 **조용히 건너뛴다** —
    부팅을 막지 않고, 첫 요청 때 `_get_client`가 지연 생성한다.
    """
    if not settings.avatar_gradio_url:
        return
    try:
        t0 = time.monotonic()
        await asyncio.to_thread(_get_client)
        logger.info("아바타 클라이언트 사전 생성 완료: %.2fs", time.monotonic() - t0)
    except Exception:  # noqa: BLE001 — Colab 미기동/URL 만료 등은 부팅을 막지 않음
        logger.warning("아바타 클라이언트 사전 생성 건너뜀 (첫 요청 시 생성됨)", exc_info=True)


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


def _reap_transcodes() -> None:
    for t in list(_transcodes):
        done = t["proc"].poll() is not None
        old = time.monotonic() - t["t0"] > _TRANSCODE_MAX_AGE_S
        if done or old:
            try:
                t["proc"].kill()
            except Exception:  # noqa: BLE001
                pass
            shutil.rmtree(t["dir"], ignore_errors=True)
            _transcodes.remove(t)


def _playlist_has_segment(playlist: Path) -> bool:
    try:
        text = playlist.read_text()
    except OSError:
        return False
    return any(line and not line.startswith("#") for line in text.splitlines())


def _feed_colab_to_ffmpeg(colab_m3u8: str, proc: subprocess.Popen) -> None:
    """Colab HLS 세그먼트를 도착 순서대로 다운로드해 ffmpeg의 stdin(파이프)에 흘려넣는다.

    ffmpeg에게 라이브 HLS URL을 직접 물리면 Colab 스트림의 세그먼트별 PTS 리셋+corrupt 패킷
    때문에 1~2세그먼트 만에 EOF로 오판하고 죽는다(실측). 대신 우리가 세그먼트 바이트를 순서대로
    이어 **하나의 mpegts 바이트스트림**으로 stdin에 부으면, ffmpeg는 끊김 없이 전체를 읽는다.
    ENDLIST가 보이면 stdin을 닫아 ffmpeg가 마무리(출력 ENDLIST)하게 한다.
    """
    seen: set[str] = set()
    try:
        for _ in range(900):  # 최대 ~6분 (0.4초 간격)
            try:
                body = urllib.request.urlopen(colab_m3u8, timeout=10).read().decode()
            except Exception:  # noqa: BLE001 — 재생목록 일시 오류는 재시도
                time.sleep(0.3)
                continue
            for line in body.splitlines():
                if not line or line.startswith("#"):
                    continue
                seg_url = urllib.parse.urljoin(colab_m3u8, line)
                if seg_url in seen:
                    continue
                seen.add(seg_url)
                try:
                    data = urllib.request.urlopen(seg_url, timeout=20).read()
                    proc.stdin.write(data)
                    proc.stdin.flush()
                except (OSError, ValueError):
                    return  # 파이프 끊김(ffmpeg 종료) 등 — 피더 종료
            if "#EXT-X-ENDLIST" in body:
                break
            time.sleep(0.4)
    finally:
        try:
            proc.stdin.close()
        except Exception:  # noqa: BLE001
            pass


def _start_transcode(colab_m3u8: str) -> tuple[str, subprocess.Popen, Path]:
    """Colab의 조각난 HLS를 **하나의 연속 fragmented MP4**로 재인코딩한다.

    끊김의 원인은 Colab HLS가 세그먼트마다 `#EXT-X-DISCONTINUITY`+PTS 리셋을 넣는 것.
    세그먼트 바이트를 이어붙여 ffmpeg stdin(mpegts)으로 먹이고 재인코딩하면 출력은 **연속
    PTS/타임라인**이 된다. 출력을 HLS가 아니라 **fragmented MP4**로 하면, 브라우저 `<video>`가
    (hls.js 없이) **네이티브로 프로그레시브 재생**한다 → hls.js 라이브 재생목록의 "처음부터 다시
    트는" 꼬임이 원천적으로 없다. 생성되는 대로 파일에 쌓이고, /stream 엔드포인트가 그 파일을
    자라는 대로 흘려보낸다(스트리밍, 완성 대기 없음).
    """
    stream_id = uuid.uuid4().hex[:12]
    out_dir = Path(settings.avatar_stream_root) / stream_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_mp4 = out_dir / "out.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-fflags", "+genpts+discardcorrupt",
        "-f", "mpegts", "-i", "pipe:0",
        "-vf", "fps=25",
        "-af", "aresample=async=1",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-profile:v", "baseline", "-level", "3.1",  # 브라우저 호환 코덱(avc1.42E01F)
        "-g", "50", "-keyint_min", "50", "-sc_threshold", "0",
        "-c:a", "aac",
        "-avoid_negative_ts", "make_zero",
        # fragmented MP4: moov를 앞에(empty_moov) + 키프레임마다 fragment → 자라는 중에도 재생 가능
        "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4", str(out_mp4),
    ]
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )
    threading.Thread(
        target=_feed_colab_to_ffmpeg, args=(colab_m3u8, proc), daemon=True
    ).start()
    _transcodes.append(
        {"id": stream_id, "proc": proc, "dir": out_dir, "mp4": out_mp4, "t0": time.monotonic()}
    )
    return stream_id, proc, out_mp4


def _serve_continuous_sync(colab_m3u8: str) -> str:
    """연속 MP4 변환을 시작하고, 첫 조각(moov+프래그먼트)이 나오면 스트림 엔드포인트 URL 반환."""
    _reap_transcodes()
    stream_id, proc, out_mp4 = _start_transcode(colab_m3u8)
    deadline = time.monotonic() + settings.avatar_transcode_timeout_ms / 1000
    while time.monotonic() < deadline:
        # 파일에 충분히 쌓이면(≈ moov + 첫 키프레임 프래그먼트) 브라우저가 재생을 시작할 수 있다.
        if out_mp4.exists() and out_mp4.stat().st_size > 32 * 1024:
            base = settings.avatar_public_base.rstrip("/")
            return f"{base}/api/avatar/stream/{stream_id}"
        if proc.poll() is not None:  # 데이터도 못 만들고 종료 = 실패
            rc = proc.poll()
            err = proc.stderr.read().decode("utf-8", "ignore")[-500:] if proc.stderr else ""
            raise RuntimeError(f"ffmpeg 종료(rc={rc}): {err}")
        time.sleep(0.2)
    raise TimeoutError("연속 스트림 시작을 시간 내에 받지 못함")


def _find_stream(stream_id: str) -> dict | None:
    for t in _transcodes:
        if t["id"] == stream_id:
            return t
    return None


async def stream_mp4(stream_id: str):
    """자라는 fragmented MP4 파일을 처음부터 끝까지 흘려보낸다(생성 중이면 새 데이터를 기다림).

    브라우저 `<video src=/api/avatar/stream/{id}>`가 이 청크 응답을 프로그레시브로 재생한다.
    ffmpeg가 끝나고 파일을 다 읽으면 스트림을 닫는다(→ 영상 종료).
    """
    t = _find_stream(stream_id)
    if not t:
        return
    path: Path = t["mp4"]
    proc: subprocess.Popen = t["proc"]
    for _ in range(100):  # 파일 생길 때까지 잠깐 대기
        if path.exists():
            break
        await asyncio.sleep(0.1)
    if not path.exists():
        return
    with open(path, "rb") as f:
        idle = 0
        while True:
            chunk = f.read(65536)
            if chunk:
                idle = 0
                yield chunk
                continue
            if proc.poll() is not None:  # ffmpeg 종료 — 남은 것 마저 읽고 끝
                rest = f.read()
                if rest:
                    yield rest
                break
            idle += 1
            if idle > 1800:  # ~3분간 새 데이터 없으면 중단(무한 대기 방지)
                break
            await asyncio.sleep(0.1)


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
        colab_url = await asyncio.to_thread(_submit_sync, audio_path)
        logger.info("Colab HLS URL 확보: %.2fs", time.monotonic() - t0)
        # Colab의 조각난 HLS를 연속 타임라인 HLS로 재인코딩해 우리가 서빙(끊김 제거).
        stream_url = await asyncio.to_thread(_serve_continuous_sync, colab_url)
        logger.info("연속 스트림 준비: %.2fs (총)", time.monotonic() - t0)
        return {"hls_url": stream_url, "model_type": settings.avatar_model_type}
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
