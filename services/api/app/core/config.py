from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 기본값은 로컬 도커 db 컨테이너 — 실사용은 .env의 Supabase URL이 덮어씀
    database_url: str = "postgresql+asyncpg://app:app@db:5432/jobsim"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: str = "storage"
    data_dir: str = "data"
    maps_dir: str = "maps"  # 게임 맵 (geometry.json + 배경) — 컨테이너에선 /app/maps 볼륨

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
    # LLM 견고성 — 무응답·일시장애 방지
    llm_timeout_ms: int = 60_000  # Gemini 호출 타임아웃(ms). 무응답 시 실패 처리 → 요청 무한대기 차단
    llm_max_retries: int = 2  # 일시오류(429·5xx·타임아웃) 지수백오프 재시도 횟수

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

    # 과제 정답 노출 — 기본 차단. true면 /api/simulations 응답의 task에 answer·answer_guide가
    # 실린다(프론트 '확인하기'·개발 편의용). 정답이 보이면 대화로 정보를 얻을 이유가 사라져
    # 게임이 성립하지 않고, 리포트의 백분위·점수도 무의미해진다 → 시연·운영에서는 반드시 false.
    expose_answers: bool = False

    # 개인정보 암호화 (AES-256-GCM) — base64 인코딩된 32바이트 키.
    # 생성: openssl rand -base64 32 / 비우면 개발용 고정키 파생(경고 로그).
    # ⚠️ 팀 전원이 같은 키를 써야 함 (공용 DB의 암호문을 서로 복호화해야 하므로)
    aes_key: str = ""
    jwt_expires_minutes: int = 60 * 24

    # OAuth 소셜 로그인 — provider별 client_id/secret은 .env로만(DM 공유, 커밋 금지).
    # 비어 있으면 해당 provider 로그인은 503(미설정)로 응답 → 시크릿 넣는 순간 활성화.
    oauth_google_client_id: str = ""
    oauth_google_client_secret: str = ""
    oauth_kakao_client_id: str = ""
    oauth_kakao_client_secret: str = ""  # 카카오는 REST API 키가 client_id, secret은 선택
    oauth_naver_client_id: str = ""
    oauth_naver_client_secret: str = ""
    # 콜백을 받는 백엔드 공개 주소 (배포 시 https 도메인). redirect_uri = {base}/api/auth/oauth/{provider}/callback
    oauth_redirect_base: str = "http://localhost:8000"
    # 로그인 성공 후 토큰을 실어 돌려보낼 프론트 주소 ({frontend}/#access_token=...)
    frontend_url: str = "http://localhost:5173"


settings = Settings()
