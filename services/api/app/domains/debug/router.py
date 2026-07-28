"""클라이언트 텔레메트리 수신 — 브라우저 안에서만 보이던 지표를 서버 로그로 올린다.

STT(Web Speech)와 FPS(비디오 재생)는 전부 브라우저 안에서 일어나 VM의
`docker compose logs`로는 절대 안 보였다(2026-07-28 채널 감사). 평가 요구사항에
stt·fps가 명시돼 있어, 프론트가 측정값을 여기로 쏘면 `[CLIENT-FPS]`/`[STT]` 한 줄
로그로 바꿔 다른 채널([LLM-USAGE]·[TTS]·[RELAY-TIMING])과 같은 터미널에 흐르게 한다.

인증 없음 — 시연·평가용 텔레메트리라 부담을 없앴다. 대신 본문을 계측 필드만
골라 읽고 원문 텍스트는 80자로 끊는다(로그 폭주·개인정보 축적 방지).
"""
import logging

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/debug", tags=["debug"])


def _num(payload: dict, key: str):
    v = payload.get(key)
    return v if isinstance(v, (int, float)) else None


@router.post("/client-metrics")
async def client_metrics(request: Request) -> dict:
    # 본문이 깨져도 200으로 조용히 넘기면, 비콘이 망가진 채 오는데도 리포트에는
    # "0건"으로 보여 "그 기능을 안 썼다"로 오진하게 된다. 실패도 한 줄 남긴다.
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 — sendBeacon 등 비정형 본문
        logger.warning("[CLIENT-METRIC] 본문 파싱 실패 (ua=%s)",
                       request.headers.get("user-agent", "-")[:60])
        return {"ok": False}
    if not isinstance(payload, dict):
        logger.warning("[CLIENT-METRIC] dict가 아닌 본문: %s", type(payload).__name__)
        return {"ok": False}

    kind = payload.get("kind")
    if kind == "avatar_fps":
        # actual_fps = requestVideoFrameCallback 실측, target_fps = 서버 frame_sync 값(25)
        logger.info(
            "[CLIENT-FPS] coach=%s actual=%s target=%s ui=%s dropped=%s total=%s "
            "buffered_s=%s stalls=%s window=%s",
            payload.get("coach", "-"),
            _num(payload, "actual_fps"),
            _num(payload, "target_fps"),
            _num(payload, "ui_fps"),
            _num(payload, "dropped_frames"),
            _num(payload, "total_frames"),
            _num(payload, "buffered_s"),
            _num(payload, "stall_count"),
            payload.get("window", "1s"),
        )
    elif kind == "stt":
        text = str(payload.get("text", ""))[:80]
        logger.info(
            "[STT] event=%s ms=%s chars=%s text=%r",
            payload.get("event", "-"),
            _num(payload, "ms"),
            len(str(payload.get("text", ""))),
            text,
        )
    else:
        logger.info("[CLIENT-METRIC] %s", {k: payload[k] for k in list(payload)[:12]})
    return {"ok": True}
