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
import contextlib
import json
import logging
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import httpx
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
_CHUNK_MAX_CHARS = 140


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


def _submit_sync(audio_path: str, image_path: str) -> str:
    """블로킹 호출 — 첫 HLS URL이 나오는 즉시 반환 (전체 생성 완료를 기다리지 않음)."""
    from gradio_client import handle_file

    _reap_jobs()
    client = _get_client()
    job = client.submit(
        settings.avatar_ckpt_dir,
        settings.avatar_wav2vec_dir,
        settings.avatar_model_type,
        handle_file(image_path),
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


def split_text_chunks(text: str, max_chars: int = _CHUNK_MAX_CHARS) -> list[str]:
    """긴 답변을 문장 단위 발화 청크로 나눈다.

    SoulX는 클립마다 정면 포즈에서 시작하므로 너무 잘게 자르면 전환 튐이 커진다. 그래서 1문장씩
    먼저 나누되, 짧은 문장은 140자 안에서 묶어 과도한 클립 수를 막는다.
    """
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []

    sentences: list[str] = []
    start = 0
    for match in re.finditer(r"[.!?。！？]+(?:[\"'”’])?\s+", normalized):
        sentence = normalized[start : match.end()].strip()
        if sentence:
            sentences.append(sentence)
        start = match.end()
    tail = normalized[start:].strip()
    if tail:
        sentences.append(tail)
    if not sentences:
        sentences = [normalized]

    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(
                sentence[start : start + max_chars].strip()
                for start in range(0, len(sentence), max_chars)
                if sentence[start : start + max_chars].strip()
            )
            continue

        candidate = f"{current} {sentence}".strip() if current else sentence
        if current and len(candidate) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current = candidate

    if current:
        chunks.append(current)
    return chunks


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


# ── 선택형 아바타 ───────────────────────────────────────────────────────────
# 프론트가 발화 요청마다 avatar_id를 보낸다 — 세션·DB에 묶지 않아 상담 시작 전에도,
# 상담 도중에도 즉시 바꿀 수 있다. 표시 이름은 팀이 정할 몫이라 중립 id만 둔다.
DEFAULT_AVATAR_ID = "male"


def avatar_catalog() -> dict[str, dict]:
    """id → {image_path, voice_id}. 설정을 매번 읽어 .env 변경이 재기동 없이 반영되게 한다."""
    return {
        "male": {
            "image_path": settings.avatar_image_path,
            "voice_id": settings.elevenlabs_voice_id,
        },
        "female": {
            "image_path": settings.avatar_image_path_female,
            "voice_id": settings.avatar_voice_id_female or settings.elevenlabs_voice_id,
        },
    }


def resolve_avatar(avatar_id: str | None) -> tuple[str, str]:
    """avatar_id → (이미지 경로, 목소리 id).

    모르는 id이거나 이미지 파일이 아직 없으면 기본 아바타로 폴백한다 — 선택 UI가 에셋보다
    먼저 나와도 발화가 깨지지 않게(에셋은 나중에 파일만 넣으면 그대로 붙는다).
    """
    catalog = avatar_catalog()
    entry = catalog.get(avatar_id or DEFAULT_AVATAR_ID)
    if entry is None:
        logger.warning("알 수 없는 avatar_id=%r — 기본 아바타로 진행", avatar_id)
        entry = catalog[DEFAULT_AVATAR_ID]
    elif not Path(entry["image_path"]).is_file():
        logger.warning("아바타 이미지 없음(%s) — 기본 아바타로 진행", entry["image_path"])
        entry = catalog[DEFAULT_AVATAR_ID]
    return entry["image_path"], entry["voice_id"]


def available_avatars() -> list[dict]:
    """프론트 선택 UI용 — 고를 수 있는 아바타 id 목록. 표시 이름·썸네일은 프론트/팀이 정한다.

    image_present는 **백엔드 로컬에 이미지 파일이 있는지**라는 사실만 알려준다.
    gradio provider는 이 파일을 업로드하므로 없으면 그 아바타가 실패하지만,
    fastapi/musetalk provider는 provider 쪽 이미지를 쓰므로 false여도 정상 동작한다
    → 이 값만 보고 선택지를 숨기지 말 것.
    """
    return [
        {"id": aid, "image_present": Path(entry["image_path"]).is_file()}
        for aid, entry in avatar_catalog().items()
    ]


async def speak(text: str, voice: str | None = None, avatar_id: str | None = None) -> dict:
    """발화 텍스트 → 연속 MP4 스트림 URL. avatar_id로 아바타(이미지·목소리)를 고른다."""
    if not settings.avatar_gradio_url and not settings.avatar_fastapi_url:
        # Colab 세션이 안 떠 있으면 여기로 — 프론트는 idle 영상 유지로 폴백
        raise HTTPException(
            status_code=503,
            detail="아바타 서버가 설정되지 않았어요 (AVATAR_GRADIO_URL 또는 AVATAR_FASTAPI_URL)",
        )

    image_path, avatar_voice = resolve_avatar(avatar_id)
    if not Path(image_path).is_file():
        raise HTTPException(
            status_code=503,
            detail=f"아바타 이미지가 없어요: {image_path}",
        )
    # 호출자가 목소리를 명시하면 그게 이기고, 아니면 아바타에 딸린 목소리를 쓴다.
    voice = voice or avatar_voice

    audio, media_type = await tts_service.synthesize(text, voice)
    suffix = ".mp3" if "mpeg" in media_type else ".wav"

    # gradio_client가 경로로 업로드하므로 파일로 떨궈야 한다 (delete=False → finally에서 정리)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio)
        audio_path = tmp.name
    try:
        if settings.avatar_fastapi_url:
            return await _speak_fastapi_provider(text, audio_path, media_type, voice, avatar_id)

        t0 = time.monotonic()
        colab_url = await asyncio.to_thread(_submit_sync, audio_path, image_path)
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


async def _speak_fastapi_provider(
    text: str, audio_path: str, media_type: str, voice: str | None = None,
    avatar_id: str | None = None,
) -> dict:
    """Colab FastAPI/ngrok POC provider.

    계약:
    - POST `{AVATAR_FASTAPI_URL}/speak`
    - multipart: `audio` 파일 + `text`, `voice`, `model_type`, `seed`
    - 응답: `{stream_url}` 또는 `{hls_url}` 또는 `{video_url}`

    FastAPI provider가 연속 fMP4 재봉합/서빙까지 처리해야 끊김이 재발하지 않는다.
    """
    base = settings.avatar_fastapi_url.rstrip("/")
    timeout = max(settings.avatar_timeout_ms, settings.avatar_transcode_timeout_ms) / 1000 + 60
    t0 = time.monotonic()
    try:
        with open(audio_path, "rb") as audio_file:
            files = {
                "audio": (
                    Path(audio_path).name,
                    audio_file,
                    media_type,
                )
            }
            data = {
                "text": text,
                "voice": voice or "",
                "model_type": settings.avatar_model_type,
                "seed": str(settings.avatar_seed),
                # 어느 아바타로 말할지 — provider 쪽에서 이미지를 고르도록 함께 넘긴다.
                # (이 provider는 이미지를 업로드받지 않으므로 선택 책임이 provider에 있다.)
                "avatar_id": avatar_id or DEFAULT_AVATAR_ID,
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(
                    f"{base}/speak",
                    data=data,
                    files=files,
                    headers={"ngrok-skip-browser-warning": "true"},
                )
                res.raise_for_status()
                payload = res.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[-500:] if e.response is not None else str(e)
        logger.exception("아바타 FastAPI provider HTTP 실패")
        raise HTTPException(status_code=502, detail=f"아바타 FastAPI provider 실패: {detail}") from e
    except Exception as e:  # noqa: BLE001
        logger.exception("아바타 FastAPI provider 통신 실패")
        raise HTTPException(status_code=502, detail="아바타 FastAPI provider와 통신하지 못했어요.") from e

    stream_url = payload.get("stream_url") or payload.get("hls_url") or payload.get("video_url")
    stream_id = payload.get("stream_id")
    if not stream_id and stream_url:
        # ngrok URL 마지막 경로 세그먼트가 stream_id (…/stream/<id>)
        stream_id = stream_url.rstrip("/").split("/")[-1]
    if not stream_id:
        raise HTTPException(status_code=502, detail="아바타 FastAPI provider 응답에 stream ID가 없어요.")

    # ⚠️ ngrok 무료 URL을 브라우저 <video>가 직접 열면 interstitial(HTML 경고)이 떠서
    # CORB로 차단된다(<video>는 ngrok-skip-browser-warning 헤더를 못 붙임).
    # → 우리 백엔드가 같은 origin으로 프록시(skip 헤더 붙여 대신 받아옴)한 URL을 반환한다.
    public_base = settings.avatar_public_base.rstrip("/")
    proxy_url = f"{public_base}/api/avatar/fastapi-stream/{stream_id}"

    logger.info(
        "FastAPI 아바타 스트림 준비: %.2fs (proxy=%s, colab_id=%s, provider_first_ready=%s)",
        time.monotonic() - t0,
        proxy_url,
        stream_id,
        payload.get("first_ready_s"),
    )
    return {
        "hls_url": proxy_url,
        "model_type": payload.get("model_type") or settings.avatar_model_type,
        "provider": "fastapi",
    }


async def proxy_fastapi_stream(stream_id: str):
    """Colab FastAPI/ngrok의 `/stream/<id>`를 우리 백엔드가 대신 받아 브라우저로 흘려보낸다.

    브라우저 <video src>는 커스텀 헤더를 못 붙여 ngrok interstitial(HTML)에 걸리고
    CORB로 차단된다. 여기서 `ngrok-skip-browser-warning` 헤더를 달아 프록시하면 같은 origin의
    video/mp4로 전달돼 정상 재생된다.
    """
    base = settings.avatar_fastapi_url.rstrip("/")
    url = f"{base}/stream/{stream_id}"
    # 스트림은 길 수 있으니 read 타임아웃은 없앤다(connect만 제한).
    timeout = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "GET", url, headers={"ngrok-skip-browser-warning": "true"}
        ) as resp:
            if resp.status_code != 200:
                body = (await resp.aread())[:500]
                logger.error("FastAPI 스트림 프록시 실패 %s: %r", resp.status_code, body)
                return
            async for chunk in resp.aiter_bytes():
                yield chunk


# ── MuseTalk WebSocket 릴레이 ────────────────────────────────────────────────
# 프론트(브라우저) ↔ 우리 백엔드 ↔ 코랩 MuseTalk WS 를 **투명 양방향**으로 잇는다.
# 백엔드는 내용을 만들지 않고 그대로 중계만 한다:
#   - 프론트→코랩: 텍스트 JSON(발화 요청 `{text, ...}`)
#   - 코랩→프론트: status 텍스트(JSON) + fMP4 프레임(바이너리) → 프론트가 MSE로 append
# ngrok interstitial은 **서버 사이드 핸드셰이크**에서 skip 헤더로 회피(브라우저는 헤더 못 붙임).


async def _pump_bidirectional(client_ws, upstream) -> None:
    """client_ws(스타렛 WebSocket) ↔ upstream(websockets 연결)을 양방향으로 편다.

    한쪽이 닫히면 반대쪽도 닫아 두 태스크가 같이 끝나게 한다.
    """
    from fastapi import WebSocketDisconnect

    async def client_to_upstream() -> None:
        try:
            while True:
                msg = await client_ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if (txt := msg.get("text")) is not None:
                    await upstream.send(txt)
                elif (data := msg.get("bytes")) is not None:
                    await upstream.send(data)
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001 — 릴레이 파이프 정리용
            logger.debug("client→upstream 종료", exc_info=True)
        finally:
            with contextlib.suppress(Exception):
                await upstream.close()

    async def upstream_to_client() -> None:
        try:
            async for msg in upstream:
                if isinstance(msg, (bytes, bytearray)):
                    await client_ws.send_bytes(bytes(msg))
                else:
                    await client_ws.send_text(msg)
        except Exception:  # noqa: BLE001 — 코랩 끊김 등
            logger.debug("upstream→client 종료", exc_info=True)
        finally:
            with contextlib.suppress(Exception):
                await client_ws.close()

    await asyncio.gather(client_to_upstream(), upstream_to_client())


async def relay_musetalk_ws(client_ws) -> None:
    """프론트 WS를 코랩 MuseTalk WS로 투명 릴레이. `client_ws`는 이미 accept된 상태.

    `AVATAR_MUSETALK_WS_URL` 미설정이면 정책 코드로 닫는다.
    """
    ws_url = settings.avatar_musetalk_ws_url.strip()
    if not ws_url:
        with contextlib.suppress(Exception):
            await client_ws.close(code=1011, reason="MuseTalk WS 미설정")
        return

    import websockets

    try:
        async with websockets.connect(
            ws_url,
            additional_headers={"ngrok-skip-browser-warning": "true"},
            max_size=None,  # fMP4 프레임이 클 수 있어 프레임 크기 제한 해제
            ping_interval=20,
            ping_timeout=20,
            open_timeout=15,
        ) as upstream:
            logger.info("MuseTalk WS 연결: %s", ws_url)
            await _pump_bidirectional(client_ws, upstream)
    except Exception:  # noqa: BLE001 — 코랩 미기동/URL오류/핸드셰이크 실패
        logger.exception("MuseTalk WS 릴레이 실패: %s", ws_url)
        with contextlib.suppress(Exception):
            await client_ws.close(code=1011, reason="코랩 서버 연결 실패")


# ── MuseTalk 워밍업 (콜드스타트 제거) ────────────────────────────────────────
# UNet forward + ffmpeg는 **첫 실제 발화**에서만 데워진다(모델 로드만으론 부족 → 첫 요청 ~23초).
# 랜딩/로그인 등 진입점에서 더미 발화를 미리 쏴 예열한다. 단 여러 진입점(랜딩→로그인 등)에서
# 중복 요청될 수 있고 UNet+ffmpeg가 무거우니, **진행 중이거나 최근에 끝났으면 no-op**으로 dedup한다.
# (단일 워커 async라 check→set 사이에 await가 없어 별도 락 없이 안전.)
_warmup_state: dict = {"in_progress": False, "warmed_at": 0.0}
_WARMUP_COOLDOWN_S = 240.0  # 최근 예열 후 이 시간 내 재요청은 무시


async def warmup_musetalk() -> dict:
    """더미 발화로 MuseTalk 추론 경로 예열. 중복 요청은 dedup(no-op)."""
    if not settings.avatar_musetalk_ws_url.strip():
        return {"status": "disabled"}
    now = time.monotonic()
    if _warmup_state["in_progress"]:
        return {"status": "already_warming"}
    if _warmup_state["warmed_at"] and now - _warmup_state["warmed_at"] < _WARMUP_COOLDOWN_S:
        return {"status": "recently_warmed", "age_s": round(now - _warmup_state["warmed_at"], 1)}

    _warmup_state["in_progress"] = True
    t0 = time.monotonic()
    try:
        await asyncio.wait_for(_fire_dummy_warmup(), timeout=90)
        _warmup_state["warmed_at"] = time.monotonic()
        elapsed = round(time.monotonic() - t0, 1)
        logger.info("MuseTalk 워밍업 완료: %.1fs", elapsed)
        return {"status": "warmed", "elapsed_s": elapsed}
    except Exception:  # noqa: BLE001 — 코랩 미기동 등. 예열 실패해도 서비스는 계속
        logger.warning("MuseTalk 워밍업 실패", exc_info=True)
        return {"status": "failed"}
    finally:
        _warmup_state["in_progress"] = False


async def _fire_dummy_warmup() -> None:
    """코랩에 더미 발화 1회 — done까지 소비해 GPU를 비우고(다음 실제 요청이 큐잉 안 되게) 끝낸다."""
    ws_url = settings.avatar_musetalk_ws_url.strip()
    import websockets

    async with websockets.connect(
        ws_url,
        additional_headers={"ngrok-skip-browser-warning": "true"},
        max_size=None,
        open_timeout=15,
        ping_interval=20,
    ) as ws:
        await ws.send(json.dumps({"speaker_id": "coach", "text": "안녕하세요."}))
        async for m in ws:
            if isinstance(m, str):
                try:
                    if json.loads(m).get("type") in ("done", "error"):
                        return
                except Exception:  # noqa: BLE001
                    continue


async def speak_chunk_events(text: str, voice: str | None = None, avatar_id: str | None = None):
    """문장 청킹 아바타 생성 이벤트.

    첫 청크 URL을 받자마자 프론트가 재생을 시작하고, 이 제너레이터는 이어서 다음 청크를 만든다.
    사용자가 첫 클립을 보는 동안 다음 TTS/SoulX/ffmpeg 작업이 겹쳐져 체감 대기 시간이 줄어든다.
    """
    chunks = split_text_chunks(text)
    yield {
        "event": "plan",
        "data": json.dumps(
            {"total": len(chunks), "chunks": chunks},
            ensure_ascii=False,
        ),
    }

    for index, chunk in enumerate(chunks):
        t0 = time.monotonic()
        try:
            result = await speak(chunk, voice, avatar_id)
        except HTTPException as e:
            yield {
                "event": "error",
                "data": json.dumps(
                    {"index": index, "status": e.status_code, "detail": e.detail},
                    ensure_ascii=False,
                ),
            }
            return
        except Exception as e:  # noqa: BLE001
            logger.exception("아바타 청크 생성 실패(index=%s)", index)
            yield {
                "event": "error",
                "data": json.dumps(
                    {"index": index, "detail": str(e) or "아바타 청크 생성 실패"},
                    ensure_ascii=False,
                ),
            }
            return

        yield {
            "event": "chunk",
            "data": json.dumps(
                {
                    "index": index,
                    "total": len(chunks),
                    "text": chunk,
                    "hls_url": result["hls_url"],
                    "model_type": result["model_type"],
                    "elapsed_ms": round((time.monotonic() - t0) * 1000),
                },
                ensure_ascii=False,
            ),
        }

    yield {"event": "done", "data": json.dumps({"total": len(chunks)}, ensure_ascii=False)}
