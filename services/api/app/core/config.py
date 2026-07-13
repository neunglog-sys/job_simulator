from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 기본값은 로컬 도커 db 컨테이너 — 실사용은 .env의 Supabase URL이 덮어씀
    database_url: str = "postgresql+asyncpg://app:app@db:5432/jobsim"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: str = "storage"
    data_dir: str = "data"

    # LLM — 키가 없으면 자동으로 mock 프로바이더로 폴백 (개발용)
    llm_provider: str = "openai"  # openai | gemini | mock
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"  # Vertex에선 global 엔드포인트 전용 (us-central1엔 없음)
    # Gemini 인증 모드 — 기본은 AI Studio(gemini_api_key).
    # GCP $300 크레딧(Vertex AI)으로 쓰려면 .env에:
    #   GOOGLE_GENAI_USE_VERTEXAI=true / GOOGLE_CLOUD_PROJECT=<프로젝트ID> / GOOGLE_CLOUD_LOCATION=us-central1
    #   + GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp-key.json (서비스계정 JSON 경로)
    google_genai_use_vertexai: bool = False
    google_cloud_project: str = ""
    google_cloud_location: str = "global"  # gemini-3.5-flash가 global 전용이라 기본 global

    # 임베딩 (RAG) — Gemini로 통일. output_dimensionality로 doc_chunks 차원(1536) 유지
    # (마이그레이션 없이 기존 Vector(1536) 컬럼 재사용). 재임베딩 필요.
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 1536

    # TTS — OPENAI_API_KEY 없으면 mock(비프음 WAV)으로 폴백
    tts_model: str = "tts-1"
    tts_voice: str = "nova"

    # CORS — 프론트 개발 서버 주소 (콤마 구분)
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://localhost"

    # Auth — 시연/배포 전 .env에서 jwt_secret 교체 필수 (HS256 권장 최소 32바이트)
    jwt_secret: str = "dev-only-secret-change-me-before-demo-0123456789"

    # 개인정보 암호화 (AES-256-GCM) — base64 인코딩된 32바이트 키.
    # 생성: openssl rand -base64 32 / 비우면 개발용 고정키 파생(경고 로그).
    # ⚠️ 팀 전원이 같은 키를 써야 함 (공용 DB의 암호문을 서로 복호화해야 하므로)
    aes_key: str = ""
    jwt_expires_minutes: int = 60 * 24


settings = Settings()
