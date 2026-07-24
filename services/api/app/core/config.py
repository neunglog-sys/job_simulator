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
    # 2026-07-23 3.5-flash → 3.6-flash. 검증: 프로덕션 프롬프트 기준 품질 차이 없음(t=+0.77,
    # n=10 페어드) · 전체 응답 13.5% 빠름 · thinking_budget=0 지원(첫토큰 지연 회귀 없음).
    # ⚠️ 모델 교체 시 thinking_budget=0 지원 여부를 반드시 확인할 것 — consultation/service.py가
    #    이 값을 하드코딩하는데, gemini-2.5-pro 계열은 이 파라미터를 400으로 거부해 상담이 죽는다.
    gemini_model: str = "gemini-3.6-flash"  # Vertex에선 global 엔드포인트 전용 (us-central1엔 없음)
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
    # (출력 길이 제어는 dev PR #131이 소유 — service.py char_limit→max_tokens per-call 방식.
    #  상세요청 시 char_limit=None(무제한)+skip_tts=True. 전역 config 캡은 그 설계와 충돌하므로 두지 않음.)

    # 임베딩 (RAG) — Gemini로 통일. output_dimensionality로 doc_chunks 차원(1536) 유지
    # (마이그레이션 없이 기존 Vector(1536) 컬럼 재사용). 재임베딩 필요.
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 1536
    # RAG 선택적 스킵 — 잡담/인사 턴에서 지식검색 생략. False면 기존 동작(len>=8만).
    rag_selective_skip: bool = True

    # TTS — OPENAI_API_KEY 없으면 mock(비프음 WAV)으로 폴백
    tts_model: str = "tts-1"
    tts_voice: str = "nova"
    # ElevenLabs — 팀 확정 TTS. 키 있으면 gTTS/OpenAI보다 **우선** 사용.
    # 🔒 sk_… 키는 **비밀** → .env로만(커밋 금지). eleven_flash_v2_5 = 저지연 다국어(한국어 O).
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # 기본(Rachel); 한국어는 multilingual로 재생
    elevenlabs_model: str = "eleven_flash_v2_5"  # 실시간용 저지연. 품질 우선이면 eleven_multilingual_v2

    # ── 아바타 (SoulX-FlashHead) ──────────────────────────────────────────
    # Colab에서 `gradio_app_streaming.py`를 share=True로 띄운 공개 URL.
    # ⚠️ URL은 **Colab 세션 재시작마다 바뀜** → .env 갱신 + 백엔드 재시작 필요.
    #    (gradio.live 링크 수명은 1주일이지만, 실제로는 Colab 세션이 먼저 끊겨서 그때 죽음)
    # 🔒 share 링크는 **공개**다 — URL을 아는 누구나 우리 GPU로 추론을 돌릴 수 있음.
    #    유출 주의. 프로덕션에선 인증 있는 자체 GPU로 교체할 것.
    # 비어 있으면 아바타 API가 503(미설정)으로 응답 → 프론트는 idle 영상으로 폴백.
    avatar_gradio_url: str = ""
    # POC용 직접 FastAPI provider. Colab 런타임에서 SoulX를 FastAPI로 감싸고
    # ngrok/Cloudflare Tunnel로 노출한 base URL. 설정되면 Gradio 경로보다 우선 사용한다.
    avatar_fastapi_url: str = ""
    # MuseTalk provider (WebSocket). 코랩 MuseTalk FastAPI 서버의 WS 엔드포인트.
    # 예: wss://depth-styling-resonant.ngrok-free.dev/ws
    # 설정되면 프론트가 /api/avatar/ws로 붙고, 백엔드가 이 URL로 **투명 양방향 릴레이**한다.
    # (ngrok interstitial 회피용 skip 헤더는 서버 사이드 핸드셰이크에서 붙는다.)
    # 프론트는 텍스트 JSON(발화 요청)을 올리고, 코랩은 status(JSON) + fMP4 프레임(바이너리)을 내린다.
    avatar_musetalk_ws_url: str = ""
    # 응답은 mp4가 아니라 **HLS 재생목록(.m3u8) URL**. 프론트에서 hls.js로 재생.
    # (gradio_client 기본 다운로드는 /gradio_api/file= 경로라 403 → download_files=False 필수)
    avatar_api_name: str = "/run_inference_streaming"
    avatar_ckpt_dir: str = "models/SoulX-FlashHead-1_3B"  # Colab 서버 기준 경로
    avatar_wav2vec_dir: str = "models/wav2vec2-base-960h"  # Colab 서버 기준 경로
    # lite | pro — pro는 단일 A100 실시간 불가 (실측: 간격 4.54s > 분량 3.36s = 끊김).
    # idle은 미리 만드니 pro도 되지만, 발화(lite)와 화질이 달라 전환 때 티남 → 둘 다 lite.
    avatar_model_type: str = "lite"
    # 소스가 정확히 512×512 → SoulX 출력과 같아서 리사이즈·크롭이 전혀 없음.
    avatar_image_path: str = "assets/ai_avatar_6_2.png"  # 백엔드 로컬 (매 호출 업로드)
    # 선택형 아바타 2종 — 프론트가 요청마다 avatar_id("male"|"female")를 보낸다.
    # 세션에 묶지 않아 상담 시작 전에도, 상담 중에도 언제든 바꿀 수 있다.
    # 아래 파일이 아직 없으면 /api/avatar/status가 available=false로 알려주고,
    # 발화 요청이 와도 기본 아바타로 폴백한다(선택 UI가 먼저 나와도 안 깨지게).
    avatar_image_path_female: str = "assets/ai_avatar_female.png"
    avatar_voice_id_female: str = ""  # 비우면 기본 목소리(elevenlabs_voice_id) 사용
    # 소스가 이미 512라 크롭 불필요. 크롭하면 idle 영상과 구도가 어긋나 전환 때 튐.
    avatar_use_face_crop: bool = False
    # idle 시드 스윕에서 채택 — 발화도 같은 시드를 써야 모션 성격이 일치한다.
    avatar_seed: int = 123
    avatar_timeout_ms: int = 60_000  # 첫 HLS URL 수신 대기 상한 (실측 첫 세그먼트 ≈ 1.8~2.0초)
    # 연속 서빙: Colab의 조각난 HLS(세그먼트마다 DISCONTINUITY)를 ffmpeg로 하나의 연속 타임라인
    # HLS로 재인코딩해 우리가 서빙한다 → 브라우저가 끊김 없이 재생. 아래는 브라우저가 그 스트림을
    # 받아갈 백엔드 공개 주소(브라우저 기준) + 출력 저장 루트.
    avatar_public_base: str = "http://localhost:8000"
    avatar_stream_root: str = "/app/avatar_streams"
    avatar_transcode_timeout_ms: int = 30_000  # 연속 스트림 첫 세그먼트 대기 상한

    # ── 공공데이터 API (직무 지식 RAG 보강 — scripts/harvest-public-job-data.py 전용) ──
    # 고용24(워크넷) 채용정보·NCS — 2026-07-22 포기. 신청서가 단일 양식인데 채용정보목록/상세는
    # 개인회원 이용 불가(민간 직업소개·정보제공 사업자만, 사업자등록증 등 필요) 확인돼서 발급 포기.
    # 항상 빈 값 — 스크립트는 코드만 남겨둠(재도전 시 참고용).
    work24_api_key: str = ""
    # 커리어넷 진로심리검사 — 인증키 승인 완료, /api/career-test 연동 완료(2026-07-20).
    careernet_api_key: str = ""
    # 공공데이터포털 인증키 — 보조금24(odcloud)·복지로(apis.data.go.kr) 공용.
    # 없으면 정책 카드만 생략되고 상담 흐름은 그대로 진행된다.
    data_go_kr_api_key: str = ""
    # 온통청년 청년정책API(youthcenter.go.kr) — 발급처·키 형식이 위와 다르다(UUID).
    # 없으면 이 소스만 빠지고 나머지 제도는 그대로 나온다.
    youth_policy_api_key: str = ""

    # CORS — 프론트 개발 서버 주소 (콤마 구분)
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://localhost"

    # Auth — 시연/배포 전 .env에서 jwt_secret 교체 필수 (HS256 권장 최소 32바이트)
    jwt_secret: str = "dev-only-secret-change-me-before-demo-0123456789"
    # 개발 편의 인증(X-User-Id 헤더로 임의 사용자 지정 · 토큰 없으면 데모 사용자 폴백)을
    # 허용할지. **기본 False (secure-by-default)** — 배포가 .env를 깜빡해도 익명 요청이 한
    # 데모 계정에 뒤섞이거나 X-User-Id 사칭이 되지 않는다(2026-07-22 익명→데모 유출사고 재발 방지).
    # 로컬 개발은 .env에 ALLOW_DEV_AUTH=true 를 명시한다(테스트는 conftest의 client fixture가 자체 활성화).
    allow_dev_auth: bool = False

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
