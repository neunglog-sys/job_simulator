# 백엔드 아키텍처 설계서

> 나의 직무 아카데미아 — AI 아바타와 함께하는 직무 탐색·체험 플랫폼
> 기준: 2026 제8회 KDT 해커톤 참가신청서 / 예선 MVP 기한 8.6

## 1. 설계 원칙

| 원칙 | 이유 |
|---|---|
| **모듈러 모놀리스** (FastAPI 단일 앱 + 도메인 모듈) | 백엔드 2명·10일 MVP. 마이크로서비스는 본선 고도화 때 분리 |
| **Docker Compose 배포** | 팀원 전원 동일 환경, 시연 환경 재현성 확보 |
| **DB는 PostgreSQL + pgvector 하나로** | RAG용 벡터 검색까지 한 컨테이너로 해결, 인프라 최소화 |
| **LLM Provider 추상화** | GPT ↔ Gemini 교체 가능 (신청서 명시), 장애 시 폴백 |
| **프롬프트/시나리오는 코드가 아닌 데이터** | `data/` 폴더의 YAML/JSON → 기획자(비개발 팀원)도 직무 콘텐츠 추가 가능 |

## 2. 시스템 구성도

```
                        ┌──────────────────────────────────────────┐
                        │              Docker Compose               │
┌─────────┐   HTTPS     │  ┌────────┐    ┌──────────────────────┐  │
│ Browser │◄───────────►│  │  web   │───►│        api           │  │
│ (React) │  WS/SSE     │  │ nginx  │ /api│      FastAPI         │  │
└─────────┘             │  └────────┘    │ ┌──────────────────┐ │  │
                        │                │ │ auth             │ │  │
                        │                │ │ consultation ────┼─┼──┼──► LLM API
                        │                │ │ recommendation   │ │  │   (GPT/Gemini)
                        │                │ │ simulation       │ │  │
                        │                │ │ npc          ────┼─┼──┼──► TTS/STT API
                        │                │ │ scoring          │ │  │
                        │                │ │ reporting        │ │  │
                        │                │ └──────────────────┘ │  │
                        │                └──────┬────────┬──────┘  │
                        │                       │        │         │
                        │              ┌────────▼──┐  ┌──▼──────┐  │
                        │              │ postgres  │  │ redis   │  │
                        │              │ +pgvector │  │(세션/상태)│  │
                        │              └───────────┘  └─────────┘  │
                        │   volumes: storage/ (대화로그·PDF리포트)   │
                        └──────────────────────────────────────────┘
```

- **web**: React 빌드 산출물을 nginx로 서빙, `/api`·`/ws`는 api 컨테이너로 리버스 프록시
- **api**: FastAPI 단일 프로세스(uvicorn). NPC 자유 대화는 WebSocket, 아바타 상담 응답은 SSE 스트리밍
- **postgres(+pgvector)**: 영속 데이터 전부 + RAG 벡터 검색
- **redis**: 시뮬레이션 세션 상태(State Machine 스냅샷)·대화 메모리 캐시. *MVP에서 빠듯하면 생략하고 Postgres로 대체 가능 — 인터페이스만 추상화해둘 것*
- **storage 볼륨**: `storage/logs`(대화·행동 로그), `storage/reports`(생성된 PDF)

## 3. 레포 폴더 매핑

| 폴더 | 역할 |
|---|---|
| `services/api/app/` | FastAPI 진입점 + 라우터 + 도메인 모듈 (아래 §4) |
| `services/ai/avatar-consultation/` | 아바타 상담 프롬프트 체인·대화 메모리 로직 |
| `services/ai/recommendation/` | Rule-based Scoring + LLM 성향 분석 → 직무 추천 |
| `services/ai/npc/` | NPC 페르소나 로딩·상태 반영 대화 생성 |
| `services/ai/scoring/` | State Machine + Rule Engine (신뢰도·일정 안정도·요구사항 명확도) |
| `services/reporting/` | 종합 분석 → HTML 템플릿 → PDF 변환(WeasyPrint) |
| `packages/shared/` | Pydantic 스키마·상수 (프론트 TS 타입과 계약 동기화) |
| `data/jobs/` | 직무 정의(직무명·업무 단계·요구 역량) YAML |
| `data/scenarios/` | 시나리오 정의: 미션·분기·상태 전이 규칙 YAML |
| `data/prompts/{avatar,npc,job-master}/` | 역할별 시스템 프롬프트 템플릿 |
| `data/evaluation/` | 평가 기준·역량 루브릭 (스코어링/리포트가 참조) |
| `infra/` | `docker-compose.yml`, Dockerfile, nginx.conf, init SQL |

`services/ai/*`는 **별도 서비스가 아니라 api가 import하는 파이썬 패키지**로 시작한다. 본선에서 부하 분리가 필요해지면 그때 컨테이너로 분리한다.

## 4. API 도메인 모듈 구조

```
services/api/app/
├── main.py                # FastAPI 앱, 라우터 등록, lifespan(데이터 로딩)
├── core/                  # 설정(env), DB 세션, redis, 보안(JWT)
├── llm/                   # ★ LLM 게이트웨이 (아래 §7)
├── domains/
│   ├── auth/              # 회원가입/로그인 (JWT, MVP는 이메일+비번만)
│   ├── consultation/      # POST /consultations, SSE 스트림, 대화 메모리
│   ├── recommendation/    # POST /recommendations  (상담 결과 → 추천 직무 목록)
│   ├── simulation/        # 세션 생성/진행, State Machine 실행
│   │                      #   WS /ws/simulations/{id}  (NPC 자유 대화)
│   ├── scoring/           # 행동 로그 적재, 상태값 계산 (simulation이 호출)
│   └── reporting/         # POST /reports → PDF 생성, GET /reports/{id}
└── content/               # data/ 폴더 로더 (jobs·scenarios·prompts·evaluation)
```

### 핵심 API (MVP 범위)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/signup`, `/login` | JWT 발급 |
| POST | `/api/consultations` | 상담 세션 시작 |
| POST | `/api/consultations/{id}/messages` | 사용자 발화 → 아바타 응답(SSE) |
| POST | `/api/recommendations` | 상담 이력 분석 → 추천 직무 3개 + 근거 |
| POST | `/api/simulations` | 직무 선택 → 시나리오 세션 생성 |
| WS | `/ws/simulations/{id}` | NPC 자유 대화 + 미션 이벤트 + 상태값 변화 push |
| POST | `/api/simulations/{id}/actions` | 선택지/과제 제출 (비대화 행동) |
| POST | `/api/reports` | 세션 종합 → PDF 생성 (비동기, 상태 폴링) |
| GET | `/api/reports/{id}` | 리포트 메타 + PDF 다운로드 URL |
| POST | `/api/tts` | 아바타 발화 텍스트 → 음성 (외부 TTS 프록시) |

## 5. 데이터 모델 개요

```
users                 (id, email, pw_hash, name, created_at)
consultations         (id, user_id, status, summary)          -- 상담 세션
messages              (id, consultation_id|simulation_id, role, content, created_at)
jobs                  (id, code, title, description, competencies jsonb)   -- data/jobs 시드
scenarios             (id, job_id, title, steps jsonb, transitions jsonb)  -- data/scenarios 시드
npc_personas          (id, scenario_id, name, rank, personality, system_prompt)
recommendations       (id, user_id, consultation_id, results jsonb)  -- [{job_id, score, reason}]
simulations           (id, user_id, scenario_id, state jsonb, status)
    -- state: {step, trust, schedule_stability, requirement_clarity, flags…}
action_logs           (id, simulation_id, type, payload jsonb, state_delta jsonb, ts)
reports               (id, user_id, simulation_id, fit_score, strengths jsonb,
                       improvements jsonb, pdf_path, status)
doc_chunks            (id, source, content, embedding vector)   -- RAG (pgvector)
```

- `jobs`·`scenarios`·`npc_personas`는 앱 기동 시 `data/`에서 **시드 업서트** — 콘텐츠 수정 = 파일 수정 + 재기동
- 시뮬레이션 진행 중 상태는 redis(핫), 스텝 종료 시 Postgres `simulations.state`에 스냅샷(콜드)

## 6. 핵심 플로우

### ① 상담 → 추천
```
사용자 발화 → consultation: 최근 N턴 + 요약(Conversation Memory)으로 컨텍스트 구성
  → llm 게이트웨이(아바타 프롬프트) → SSE 스트림 응답 + messages 저장
상담 종료 → recommendation:
  LLM으로 성향·관심사·강점 구조화 추출(JSON)
  → Rule-based Scoring: data/evaluation 가중치 × jobs 역량 매트릭스
  → 상위 3개 직무 + 추천 근거 반환
```

### ② 시뮬레이션 (게이미피케이션 코어)
```
직무 선택 → scenario 로드 → State Machine 초기화(step=1, 상태값 기본치)
루프:
  [자유 대화] WS 수신 → npc: 페르소나 + 현재 상태값 + RAG(직무 지식) → 응답
  [행동]     선택지/과제 제출 → scoring: Rule Engine이 상태값 delta 계산
  → state 갱신 → 전이 조건 충족 시 다음 step/미션 push → action_logs 적재
종료 조건(전 스텝 완료 or 상태값 임계) → 세션 close
```
State Machine 정의(상태·전이·delta 규칙)는 `data/scenarios/*.yaml`에 선언 — 코드 수정 없이 시나리오 추가.

### ③ 리포트
```
POST /reports → BackgroundTasks:
  action_logs + messages + 최종 state 집계
  → LLM(직무 마스터 프롬프트): 적합도·강점·보완점·조언 생성(JSON)
  → HTML 템플릿 렌더 → WeasyPrint PDF → storage/reports 저장
프론트는 status 폴링 → 완료 시 다운로드
```
*(MVP는 FastAPI BackgroundTasks로 충분. 본선에서 병목이면 워커 큐 분리)*

## 7. LLM 게이트웨이 (`app/llm/`)

```python
class LLMClient(Protocol):
    async def chat(self, messages, *, system, json_schema=None, stream=False): ...

# providers: openai.py / gemini.py  — env LLM_PROVIDER로 선택, 실패 시 폴백
```

- **프롬프트는 전부 `data/prompts/`의 템플릿** + 변수 주입(Jinja2). 코드에 프롬프트 하드코딩 금지
- 구조화 출력(추천·리포트)은 JSON 스키마 강제 + 파싱 실패 시 1회 재시도
- 모든 호출 로깅(토큰·지연시간) → `storage/logs` — 시연 전 비용/품질 튜닝 근거
- RAG: 직무 지식·평가 기준을 임베딩 → `doc_chunks` → NPC/마스터 프롬프트에 top-k 주입

## 8. Docker 구성 (`infra/`)

```yaml
# docker-compose.yml (요지)
services:
  web:      # nginx: React 정적 서빙 + /api,/ws 프록시
    build: ../apps/web
    ports: ["80:80"]
    depends_on: [api]
  api:
    build: ../services/api
    env_file: ../.env            # LLM_PROVIDER, OPENAI_API_KEY, GEMINI_API_KEY …
    volumes:
      - ../data:/app/data:ro     # 콘텐츠(직무·시나리오·프롬프트)
      - ../storage:/app/storage  # 로그·PDF
    depends_on: [db, redis]
  db:
    image: pgvector/pgvector:pg16
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
volumes: { pgdata: }
```

- 개발: `docker compose up db redis`만 띄우고 api/web은 로컬 핫리로드 → **compose 파일을 dev/prod 오버라이드로 분리** (`compose.override.yml`)
- 시연: `docker compose up -d` 한 방. `.env.example`에 필요 키 전부 명시

## 9. 단계별 구축 순서 (예선 MVP 7.27~8.6)

| 순서 | 작업 | 비고 |
|---|---|---|
| 1 | compose + FastAPI 스켈레톤 + DB 마이그레이션(alembic) | 1일차에 전원 `docker compose up` 되게 |
| 2 | llm 게이트웨이 + content 로더 | 이후 모든 도메인의 토대 |
| 3 | consultation (SSE 상담) | 프론트 메인 화면과 병행 |
| 4 | recommendation (룰 스코어링) | data/evaluation 기획과 병행 |
| 5 | simulation + npc (WS, State Machine) | **최대 리스크 — 가장 먼저 스파이크 검증** |
| 6 | scoring 로그 적재 → reporting PDF | 리포트는 템플릿 먼저 고정 |
| 7 | auth는 마지막 (그 전까지 X-User-Id 헤더 스텁) | 시연에 로그인은 부차적 |

## 10. 본선 고도화 포인트 (지금은 안 함, 문만 열어둠)

- `services/ai/*`를 독립 컨테이너로 분리 (LLM 호출 부하 격리)
- 리포트 생성을 워커 큐(arq/celery)로 이관
- STT 실시간 스트리밍 (예선은 브라우저 Web Speech API로 대체 가능)
- 직무군·난이도별 시나리오 확장 — data/ 스키마는 이미 대응됨
- 관리자 페이지 (B2B 리포트 대시보드)
