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
    gemini_model: str = "gemini-2.0-flash"

    # 임베딩 (RAG) — doc_chunks.embedding 차원(1536)과 맞아야 함
    embedding_model: str = "text-embedding-3-small"

    # CORS — 프론트 개발 서버 주소 (콤마 구분)
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://localhost"

    # Auth — 시연/배포 전 .env에서 jwt_secret 교체 필수 (HS256 권장 최소 32바이트)
    jwt_secret: str = "dev-only-secret-change-me-before-demo-0123456789"
    jwt_expires_minutes: int = 60 * 24


settings = Settings()
