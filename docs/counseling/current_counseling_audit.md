# 현재 상담 구조 조사 (Audit)

작성일: 2026-07-13
브랜치: `feat/counseling-prompt-data` (base: `origin/dev` @ `c0392c9`)
작성자 역할: 상담 프로세스 조사 담당 (DB·백엔드·미션 비담당)

이 문서는 상담 데이터팩·프롬프트를 만들기 전에, 이미 병합된 상담/추천/미션 구조를
있는 그대로 기록한 것이다. 아래에서 "확인됨"이라고 쓴 내용만 근거로 삼았고, 실제
코드에 없는 것은 "존재하지 않음"이라고 명시했다.

## 1. 조사한 PR 요약

| PR | 제목 | 핵심 내용 |
|---|---|---|
| #2 | 백엔드 기반 레이어 구축 | DB 11테이블, YAML 콘텐츠 시스템, LLM 게이트웨이(mock 폴백), 상담 API(SSE 스트리밍) |
| #3 | 직무 추천 API + Supabase 전환 | `/api/recommendations`, DB를 Supabase 클라우드로 전환 |
| #6 | 개인정보·대화 AES-256-GCM 암호화 | `EncryptedText` 컬럼 타입, `users.email/name`, `consultations.summary`, `messages.content` 암호화 |
| #7 | 상담 RAG 연결 + 적성 중간결론·추천 게이트 | RAG 지식 주입, `aptitude_clarity` 게이트(409), 중간결론 프롬프트 지시 |
| #9 | 팀 조사자료 KB v5 + 팀통합 8모듈 DB 적재 | 엑셀 2종 → 원천 테이블 8종 (가공 없이 셀 그대로 적재) |
| #10 | KB v5 스테이지 인지 검색 함수 | `get_stage_chunk`, `get_job_chunks`, `search_job_stage` (미션 RAG용, 결정적 조회) |
| #11 | 시뮬레이션 게임엔진 확장 | 힌트 3단계, 돌발 퀘스트(`Scenario.sudden_quest`), 시나리오 목록 API |

PR #7 본문 인용 (게이트 부분):
> "아바타: '모르겠어요' 응답 시 경험 기반 질문으로 파고들기, 평가조 금지, 상담 마무리
> 전 중간 결론 필수 발화" / "추천 게이트: 추출 시 aptitude_clarity(0~100) 판정 →
> 50 미만이면 추천 생성 안 하고 409"

## 2. 실제 관련 코드 경로

| 항목 | 경로 |
|---|---|
| 상담 API 라우터 | `services/api/app/domains/consultation/router.py` |
| 상담 스키마 | `services/api/app/domains/consultation/schemas.py` |
| 상담 서비스 로직 | `services/api/app/domains/consultation/service.py` |
| 추천 서비스 로직(게이트 포함) | `services/api/app/domains/recommendation/service.py` |
| RAG 지식 검색 | `services/api/app/content/knowledge.py` |
| 조사자료 원천 테이블 적재 스크립트 | `services/api/app/scripts/load_research.py` |
| DB 모델 전체 | `services/api/app/models/__init__.py` |
| YAML 콘텐츠 로더(직무/시나리오/역량) | `services/api/app/content/loader.py` |
| 프롬프트 렌더러(Jinja2) | `services/api/app/llm/prompts.py` |
| 프롬프트 파일 | `data/prompts/**/*.md` |
| 암호화 | `services/api/app/core/crypto.py` (컬럼 타입은 `EncryptedText`, 모델에서 사용) |
| 테스트 | `tests/backend/*.py` (pytest, `docker compose exec api python -m pytest tests/backend`로 실행) |

## 3. 상담 API 요청·응답 스키마 (확인됨)

- `POST /api/consultations` — 세션 생성. 인증은 `X-User-Id` 헤더 스텁(없으면 데모 유저 자동 생성).
- `POST /api/consultations/{id}/messages` — 사용자 발화 전송 → 아바타 응답 **SSE 스트리밍**
  (`token` 이벤트 반복 → `done`).
- `GET /api/consultations/{id}/messages` — 대화 이력 조회.
- 세션 상태(`Consultation.status`)는 `active | completed` 단 두 값. 세부 단계(질문 단계,
  중간요약 단계 등)를 구분하는 **명시적 상태머신은 코드에 없음** — 진행 흐름은 전부
  `avatar/system.md` 프롬프트 지시문에 의해 LLM이 자율적으로 통제한다.

## 4. 대화 저장 구조 (확인됨)

`Message` 테이블 — `consultation_id | simulation_id | role(user|assistant|npc:{name}) | content`.
`content`는 `EncryptedText` (AES-256-GCM, PR #6). 상담·시뮬레이션 대화가 같은 테이블을
공유한다. `Conversation Memory`는 최근 20턴(`MEMORY_TURNS = 20`, `consultation/service.py:15`)만
LLM 컨텍스트에 포함.

## 5. 암호화 적용 지점 (확인됨)

- `User.email`, `User.name`, `Consultation.summary`, `Message.content` → `EncryptedText`.
- 사용자 조회는 평문이 아니라 `User.email_hash`(SHA 계열 해시, unique) 기준.
- **이번 작업은 이 레이어를 건드리지 않는다** — 데이터팩·프롬프트는 암호화 대상 컬럼에
  값을 쓰지 않고, 기존 `Message`/`Consultation` 스키마 그대로 사용한다.

## 6. LLM 프롬프트 저장 위치 (확인됨)

`data/prompts/<domain>/<name>.md` — Jinja2 템플릿, `services/api/app/llm/prompts.py`의
`render_prompt(template, **variables)`가 렌더링. `Environment(..., undefined=StrictUndefined)`
이므로 템플릿에서 참조하는 변수는 반드시 kwargs로 전달해야 하며(단, `{{ x|default(...) }}`
필터는 `StrictUndefined`에서도 안전하게 동작 — 값 타입만 확인하고 미치환 변수를
문자열화하지 않기 때문), 누락 시 `jinja2.exceptions.UndefinedError`.

현재 프롬프트 파일 전체:
```
data/prompts/avatar/system.md            상담 아바타 시스템 프롬프트 (RAG 지식 주입 지점)
data/prompts/job-master/system.md
data/prompts/job-master/consult-report.md 최종 리포트 생성
data/prompts/npc/system.md               시뮬레이션 NPC
data/prompts/recommendation/extract.md   상담 대화 → 구조화 JSON 추출(추천 게이트 판정 프롬프트)
data/prompts/scoring/evaluate.md
data/prompts/scoring/task.md
```

"성향 근거 추출", "다음 질문 선택", "적성 중간요약", "추천 설명"을 위한 **별도 프롬프트
파일은 존재하지 않는다.** 현재는:
- 다음 질문 선택 / 중간요약 발화 → `avatar/system.md`의 자유서술 지시문(§"중간 결론") 안에서
  LLM이 즉석으로 수행. 고정된 질문 뱅크나 축(axis) 커버리지 로직 없음.
- 성향 근거 추출 → `recommendation/extract.md` 한 번의 LLM 호출로 대화 전체를 스캔해
  `competency_scores / interests / strengths / summary / aptitude_clarity / followup_questions`를
  JSON으로 추출 (`recommendation/service.py:_extraction_schema`).
- 추천 설명 → `_build_reason()` (`recommendation/service.py:87`), 룰 기반 문자열 조합이며
  LLM 호출이 아니다.

## 7. 상담 RAG 검색 함수 (확인됨)

`app/content/knowledge.py`:
- `search_knowledge(session, query, job_code=None, top_k=5, max_distance=None)` — 발화별
  코사인 거리 검색, `consultation/service.py`가 `max_distance=0.65` 컷오프로 호출.
- KB v5 전용 결정적 조회: `get_stage_chunk(job_code, stage_id)`, `get_job_chunks(job_code)`,
  시맨틱 버전 `search_job_stage(...)` — source가 `kb-v5/<job_code>-<stage_id>` 형식.
- `doc_chunks.source` 네임스페이스 `kb-v5/%`는 **예약됨** (`ingest_knowledge`가 이 이름의
  `data/knowledge/kb-v5/` 폴더를 명시적으로 스킵 — `load_research.py`가 통째로 삭제·재적재하는
  영역과 충돌 방지). 데이터팩에서 이 네임스페이스를 절대 사용하지 않는다.

## 8. 적성 중간결론 스키마 (확인됨)

`recommendation/service.py:_extraction_schema()` — LLM이 한 번의 호출로 반환하는 JSON에 포함:
```json
{
  "competency_scores": {"<competency_key>": 0},
  "interests": ["..."],
  "strengths": ["..."],
  "summary": "...",
  "aptitude_clarity": 0,
  "followup_questions": ["..."]
}
```
`summary`가 곧 "중간 결론"이며, 게이트 미달 시 `consultation.summary`에 저장되어 **다음
상담 세션의 Conversation Memory로 재사용**된다(`service.py:108`). 사용자에게 별도의
"확인·수정" UI 스텝은 API 레벨에 없음 — 프론트가 409 응답을 다시 상담 화면으로
연결하는 방식(PR #7 본문 "⚠️ 프론트 팀 확인 필요").

## 9. 추천 게이트 조건 (확인됨)

`APTITUDE_CLARITY_MIN = 50` (`recommendation/service.py:25`). 단일 스칼라 임계값 — 사용자
프롬프트가 요구하는 "흥미 근거 N개 이상 / 업무방식 근거 N개 이상 / 모듈별 독립 근거"
같은 **다축·근거개수 기반 게이트는 코드에 없음**. `aptitude_clarity`는 LLM이 대화 전체를
보고 한 번에 매기는 0~100 정수 하나이며, 그 판단 근거(어떤 발화가 근거였는지)는
구조화되어 남지 않는다.

미달 시 `HTTPException(409, detail={reason, aptitude_clarity, interim_conclusion,
followup_questions, message})`.

## 10. 추천 결과 스키마 (확인됨)

`Recommendation.results: JSONB = [{job_code, score, reason}]`, 상위 3개(`TOP_N = 3`).
`_score_job()`은 `Job.competencies`(직무별 역량 가중치, 1~5)와 추출된
`competency_scores`(0~100)의 가중평균 — **완전히 결정적**(LLM 아님, 단위 테스트로
고정됨: `tests/backend/test_recommendation_scoring.py`). 추천 대상은 `jobs` 테이블
(현재 시드 2건: backend-developer, marketer)이며, **8모듈/40중분류/대표미션 테이블과는
연결되어 있지 않다** (§12 참고).

## 11. 모듈 ID (확인됨 — xlsx 원본에서 직접 추출, DB 컬럼 값과 동일)

8모듈은 코드가 아니라 **한글 문자열 그 자체가 ID**로 쓰인다
(`TeamCategory.module`, `KbJob.module`, `Scenario.module` 모두 `String` 컬럼, enum 아님):

```
대인응대형   절차·점검형   작업순서·절차형   제작·상태판단형
돌발상황 대처형   안전·위험판단형   장비·상태점검형   정보·판단형
```

임의로 영문 코드를 새로 만들지 않고 이 8개 문자열을 그대로 참조키로 사용한다.

## 12. 중분류 ID (확인됨)

`TeamCategory.category` (unique, String) — 40개, 모듈당 5개씩. `data/research/팀통합_8모듈_조사자료_표준화완료.xlsx`
시트 `01_연결맵`에서 직접 확인(가공 없이 셀 그대로 DB 적재, `load_research.py` 주석 "값은
셀 그대로 저장 — 가공·요약 없음"). 예:

```
대인응대형 → 의료·복지·상담 응대 / 교육·강의·코칭 응대 / 영업·판매·매장응대 /
             상담·안내·중개 응대 / 안내·접수·예약·프론트
절차·점검형 → 문서·법무·기록관리 / 회계·경리·정산 사무 / 총무·행정·사무보조 /
             무역·물류·운송 사무 / 생산·품질관리 사무
(전체 8모듈 × 5중분류 = 40개, data/counseling/module_mapping.json에 전량 수록)
```

## 13. 대표 미션 ID 연결 방식 (확인됨)

- `TeamMission.mission_code` (예: `KTS-01-01`) — 상황유형 5종 × 40중분류 = 200행
  (`05_상황별미션` 시트). 상황유형 5종: `정상업무 / 자료·정보 누락 / 우선순위 충돌 /
  오류·안전위험 / 보고·인계`.
- `TeamRepMission.mission_code` — 40개(중분류당 1개), `06_대표미션` 시트. **주의**: 대부분
  `-04`(오류·안전위험) 코드가 대표로 선정돼 있으나 전부는 아님(예: `YG-03-02`,
  `YS-06-01`, `YS-07-02`, `YS-10-01`) — 대표 선정은 코드 규칙이 아니라 조사 시트의
  수동 선정 결과이므로, 데이터팩은 이 값을 **그대로 참조**하고 재계산하지 않는다.
- 이 테이블들(`team_categories`, `team_missions`, `team_rep_missions`,
  `team_job_evidence`, `team_stages`)은 **"원천 조사자료" 보관용**이며, 시뮬레이션 게임엔진이
  실제로 굴리는 `scenarios` / `Scenario.sudden_quest`(PR #11, "돌발 퀘스트(대표미션)")와는
  **아직 자동으로 연결되어 있지 않다**. `Scenario.module`은 존재하지만 현재 시드된
  시나리오는 1개(`backend-dev-day1.yaml`)뿐이고 `team_categories`/`team_rep_missions`를
  참조하는 코드는 없음 (grep 결과 없음).
- 즉, **"상담 결과를 8모듈→40중분류→대표미션으로 연결"이라는 목표는 현재 데이터는
  갖춰져 있으나 연결 로직이 아직 없는 상태**다. 이번 작업 범위에서는 이 연결을
  수행하는 순수 함수(데이터팩 기반 매핑)를 추가하되, 기존 `/api/recommendations`
  응답 스키마(§10)는 변경하지 않는다 — 새 매핑 결과는 별도의, 아직 라우터에서
  호출되지 않는 유틸리티로만 추가한다 (§16 연결 지점 참고).

## 14. 기존 JSON/YAML/CSV 데이터 디렉터리 (확인됨)

```
data/jobs/*.yaml            직무 정의 (2건)
data/scenarios/*.yaml       시뮬레이션 시나리오 (1건)
data/evaluation/competencies.yaml   역량 정의
data/prompts/**/*.md        Jinja2 프롬프트
data/knowledge/<job_code>/*.md      RAG 원본 문서(임베딩 대상)
data/research/*.xlsx        팀 조사 원본 엑셀(가공 없이 원천 테이블로 적재)
```
`data/counseling/`은 아직 없음 — 이번 작업에서 신설 (사용자 제안 구조 그대로 사용).

## 15. 기존 seed 로더 (확인됨)

- `app/content/seed.py` — 기동 시 `data/jobs`, `data/scenarios`를 검증(`loader.py`) 후 DB
  업서트. **파일 추가만으로 콘텐츠 추가 가능**(코드 수정 불필요) — PR #2 설계 원칙.
- `app/scripts/load_research.py` — 팀 조사 엑셀 2종을 원천 테이블 8종으로 통째 재적재
  (멱등, 전체 delete 후 insert). `docker compose exec api python -m app.scripts.load_research`.
- 이번 작업은 **이 두 로더를 수정하지 않는다.** 새 데이터팩은 이들과 별개로
  `app/content/counseling.py`(신규, 이번 작업에서 추가)가 읽는다.

## 16. 프롬프트 로더 (확인됨 — §6과 동일)

`app/llm/prompts.py:render_prompt()`. lru_cache된 Jinja `Environment`, `auto_reload=True`.

## 17. 테스트 구조 (확인됨)

- `tests/backend/*.py`, pytest, 실행: `docker compose exec api python -m pytest tests/backend`.
- 스타일: 대부분 **순수 함수 단위 테스트**(DB/네트워크 불필요) —
  `test_recommendation_scoring.py`(스코어링 룰), `test_prompts.py`(Jinja 렌더링, `SimpleNamespace`
  mock 없이 실제 템플릿 렌더 검증), `test_crypto.py`, `test_hints.py`. 이번 작업의 신규
  테스트도 같은 스타일(순수 함수, 실제 데이터팩 파일을 직접 읽어 검증)로 작성한다.
- `conftest.py` 없음 — 픽스처 공유 없이 각 파일이 독립적.

## 18. 상담 조사자료가 들어가야 할 정확한 위치

- 데이터: `data/counseling/*.json` (신규 디렉터리, `settings.data_dir` 기준 — 컨테이너에서는
  `/app/data/counseling`, `docker-compose.yml`이 `../data:/app/data:ro`로 마운트하므로 별도
  배포 설정 불필요).
- 로더/어댑터 코드: `services/api/app/content/counseling.py` (신규) — `app/content/loader.py`,
  `app/content/knowledge.py`와 같은 레이어, 같은 컨벤션(순수 함수, `settings.data_dir` 기준 경로).
- 프롬프트: 기존 `data/prompts/avatar/system.md`, `data/prompts/recommendation/extract.md`를
  **최소 텍스트 보강**(새 Jinja 변수는 `|default(...)`로 옵셔널 처리해 기존
  `render_prompt()` 호출부·기존 테스트를 깨지 않음). 별도의 "다음 질문 선택"/"중간요약"
  프롬프트 파일은 신설하지 않는다 — PR #7 설계상 이 둘은 `avatar/system.md` 한 프롬프트
  안에서 처리되고 있고, 별도 LLM 호출 단계를 신설하는 것은 "새 상담 API를 만들지 않는다"는
  범위를 벗어나기 때문.
- 문서: `docs/counseling/*.md` (이 파일 포함 3종).
- 테스트: `tests/backend/test_counseling_data*.py` (신규, DB 불필요).

## 19. 기존 구현과 충돌하지 않는 작업 계획

1. **DB 변경 없음.** `team_categories`/`team_missions`/`team_rep_missions`는 읽기 전용으로만
   참조(문자열 비교), 새 테이블·마이그레이션·컬럼 추가 없음.
2. **API 계약 불변.** `/api/consultations*`, `/api/recommendations` 요청/응답 스키마 그대로.
   `aptitude_clarity` 임계값(50), 409 응답 형태 그대로.
3. **프롬프트는 텍스트만 보강**, 새 Jinja 변수는 전부 옵셔널(`|default`) — 기존
   `test_prompts.py`의 5개 테스트가 그대로 통과해야 함(회귀 기준).
4. **새 순수 함수 계층 추가**: `app/content/counseling.py` — 질문 선택/근거 신뢰도/후속질문/
   게이트 판정(목표안, §9의 "목표 게이트"와 실제 `aptitude_clarity` 게이트는 별개로 문서화)/
   8모듈 매핑. 전부 데이터팩 파일 → dict 변환 + 결정적 로직, LLM 호출 없음, DB 세션 불필요.
5. **연결은 상담 프롬프트(§16) 한 지점만 실제로 라우터 경로에 wiring** — `avatar/system.md`
   렌더링에 옵셔널 `safety_notes` 컨텍스트를 데이터팩에서 만들어 전달(로드 실패 시 `None`
   폴백 → 기존 프롬프트와 100% 동일하게 렌더링). 추천 게이트/모듈 매핑 로직은 **순수
   유틸리티로 추가하되 `recommendation/service.py`의 실행 경로에는 연결하지 않는다** —
   현재 라이브 게이트(`aptitude_clarity`)를 변경하는 것은 API 응답 형태(409 payload) 변경
   위험이 있어 범위를 벗어난다고 판단. 대신 최종 보고에 "이후 연결 제안(최소 diff)"을
   별도로 기록한다.
6. **회귀 테스트**: 기존 `tests/backend/test_prompts.py`,
   `test_recommendation_scoring.py`는 수정하지 않고 그대로 통과시킨다.
