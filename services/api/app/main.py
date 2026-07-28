import asyncio
import logging
import mimetypes
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.content.knowledge import ingest_knowledge
from app.content.seed import seed_content
from app.core.config import settings
from app.core.db import SessionFactory, engine
from app.core.redis import redis_client
from app.domains.auth.router import router as auth_router
from app.domains.avatar import service as avatar_service
from app.domains.avatar.router import router as avatar_router
from app.domains.careertest.router import router as careertest_router
from app.domains.policy.router import router as policy_router
from app.domains.consultation.router import router as consultation_router
from app.domains.jobs.router import router as jobs_router
from app.domains.profile.router import router as profile_router
from app.domains.recommendation.router import router as recommendation_router
from app.domains.reporting.router import router as reporting_router
from app.domains.simulation.router import router as simulation_router
from app.domains.tts.router import router as tts_router
from app.llm.gateway import warmup_llm

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
# httpx가 요청 URL을 통째로 INFO 로그에 남긴다 — 쿼리스트링으로 인증키를 보내는 외부
# API(커리어넷 등) 호출 시 키가 컨테이너 로그에 평문으로 찍히는 걸 막는다.
logging.getLogger("httpx").setLevel(logging.WARNING)

# Debian slim의 MIME DB에는 WebP가 빠진 경우가 있어 StaticFiles가
# application/octet-stream으로 응답할 수 있다. 브라우저가 맵을 이미지로
# 확실히 해석하도록 확장자 MIME을 명시한다.
mimetypes.add_type("image/webp", ".webp")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 마이그레이션은 컨테이너 기동 커맨드(alembic upgrade head)에서 선행됨
    async with SessionFactory() as session:
        await seed_content(session)
        try:
            await ingest_knowledge(session)
        except Exception:  # noqa: BLE001 — 임베딩 장애(부팅 시 Gemini 다운 등)가 앱 기동을 막지 않게
            logger.exception(
                "지식 적재 실패 — RAG 없이 기동 계속 (다음 재기동 시 해시 가드로 자동 재적재)"
            )
    # 아바타 Gradio 핸드셰이크(≈2.4초)·LLM chat_stream 콜드스타트(≈2~3초)를 기동 시 선지불
    # → 첫 사용자가 안 기다림. 서로 독립적이라 동시에 돌려 부팅 지연을 겹쳐서 흡수한다.
    # 둘 다 내부에서 예외를 삼키므로(미설정 등) 부팅을 막지 않는다.
    await asyncio.gather(avatar_service.warmup(), warmup_llm())
    yield
    await redis_client.aclose()
    await engine.dispose()


app = FastAPI(title="나의 직무 아카데미아 API", lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    """미처리 예외 → 프론트 에러 규약({detail})으로 통일 + 스택 로깅.

    기본 Starlette 500은 plain text라 프론트의 detail 파싱이 깨진다. HTTPException은
    FastAPI 기본 핸들러가 그대로 처리하므로 여기 안 온다.
    """
    logger.exception("미처리 예외: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "서버 오류가 발생했어요. 잠시 후 다시 시도해주세요."})

@app.middleware("http")
async def log_request_latency(request: Request, call_next):
    """엔드포인트 응답 시간 계측 — 평가지표 9.4(p50/p95) 산출용.

    로그 파싱만으로 백분위를 낼 수 있게 경로·상태·소요시간을 한 줄로 남긴다.
    경로는 라우트 패턴(/api/reports/{id})으로 정규화해야 id별로 흩어지지 않는데,
    미들웨어 시점엔 아직 매칭 전이라 응답 뒤 request.scope["route"]에서 꺼낸다.

    ⚠️ SSE 스트리밍 엔드포인트(상담 messages 등)에서 이 값은 **응답 시작까지**의
    시간이지 생성 완료 시간이 아니다(실측 13ms). 스트리밍 구간의 체감 지연은
    consultation.service가 남기는 '상담 응답 구간' 로그의 첫토큰·전체 ms를 봐야 한다.
    """
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    route = request.scope.get("route")
    pattern = getattr(route, "path", None) or request.url.path
    logger.info(
        "[HTTP-LATENCY] %s %s status=%d ms=%.1f",
        request.method, pattern, response.status_code, elapsed_ms,
    )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(consultation_router)
app.include_router(recommendation_router)
app.include_router(jobs_router)
app.include_router(profile_router)
app.include_router(reporting_router)
app.include_router(simulation_router)
app.include_router(tts_router)
app.include_router(avatar_router)
app.include_router(careertest_router)
app.include_router(policy_router)

# 아바타 연속 스트림 서빙 — ffmpeg가 Colab HLS를 연속 타임라인으로 재인코딩한 결과(.m3u8/.ts).
# 브라우저(hls.js)가 여기서 직접 받아 끊김 없이 재생한다.
_stream_root = Path(settings.avatar_stream_root)
_stream_root.mkdir(parents=True, exist_ok=True)
app.mount("/avatar-stream", StaticFiles(directory=str(_stream_root)), name="avatar-stream")

# 게임 맵 정적 서빙 — /maps/<맵폴더>/<배경>.png 등. 폴더가 없으면(배포 초기 등) 조용히 생략:
# 게임 API의 map 필드도 None이 되어 프론트는 기존 module 배경으로 폴백한다.
if Path(settings.maps_dir).is_dir():
    app.mount("/maps", StaticFiles(directory=settings.maps_dir), name="maps")
else:
    logger.warning("maps/ 폴더 없음 — 게임 맵 정적 서빙 비활성 (compose 볼륨 확인)")

# 아바타 사전 렌더 클립 서빙 — 인사말 등 완성 클립을 파일로 떨어뜨리면 바로 서빙된다
# (계약: docs/avatar-greeting-clip.md). 폴더는 여기서 만들어 두므로 배치만 하면 됨.
_avatar_clips = Path(settings.storage_dir) / "avatar-clips"
_avatar_clips.mkdir(parents=True, exist_ok=True)
app.mount("/avatar-clips", StaticFiles(directory=_avatar_clips), name="avatar-clips")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/deep")
async def health_deep():
    """DB·pgvector·Redis 배선 검증용 헬스체크."""
    async with SessionFactory() as session:
        pgvector = (
            await session.execute(
                text("SELECT count(*) FROM pg_extension WHERE extname = 'vector'")
            )
        ).scalar_one()
    await redis_client.ping()
    return {"status": "ok", "db": "ok", "pgvector": bool(pgvector), "redis": "ok"}
