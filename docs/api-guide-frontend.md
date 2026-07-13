# 프론트엔드 API 연동 가이드

> 대상: 윤가연·최영수 님 (React) / 작성: 백엔드 (김태수) / 기준: dev 최신
> 로컬 실행: `cd infra && docker compose up -d` → 베이스 URL `http://localhost:8000`
> 전체 스펙 브라우징: http://localhost:8000/docs (Swagger — WS 제외 전부 클릭 테스트 가능)

## 0. 한눈에 보는 사용자 플로우와 API

```
회원가입/로그인 ─→ AI 상담(SSE) ─→ 직무 추천 ─→ 맵에서 시나리오 선택
                                                      ↓
최종 리포트(PDF) ←─ 점수/백분위 ←─ 🎮 게임 플레이 (WebSocket)
```

## 1. 인증

| 방법 | 사용 시점 |
|---|---|
| `POST /api/auth/signup` `{email, password(8자+), name}` → `{access_token}` | 회원가입 (즉시 토큰) |
| `POST /api/auth/login` `{email, password}` → `{access_token}` | 로그인 |
| `GET /api/auth/me` | 내 정보 |

- 이후 모든 요청에 `Authorization: Bearer <token>` 헤더.
- **개발 편의**: 헤더를 아예 안 보내면 "데모 사용자"로 자동 처리됩니다 — 인증 UI 만들기 전에도 모든 API 테스트 가능.
- OAuth(소셜 로그인)는 프로바이더 확정 후 추가 예정.

## 2. 메인 화면 — 내 것들 목록

```
GET /api/consultations   → 내 상담 목록 (최신순) — 이어가기 진입점
GET /api/simulations     → 내 시뮬레이션 목록 {status: active=이어하기/completed=결과보기, current_step, total}
GET /api/reports         → 내 리포트 목록
```

## 2-1. AI 상담 — 흐름: 사전 설문(5지선다) → 자유대화

```
POST /api/consultations                    → {id}  상담 세션 시작
GET  /api/consultations/{id}/survey        → {items: [{id, text, options:[{key,label}]}]}  설문 문항
POST /api/consultations/{id}/survey        → {answers: {"SV-001":"a", ...}}  전 문항 필수
     응답: {profile, avatar_lines: [대사 3개]}
     → avatar_lines를 아바타 말풍선으로 순서대로 표시한 뒤 자유대화 UI로 전환
POST /api/consultations/{id}/messages      → SSE 스트림 (아래 참고) — 아바타가 설문 결과를 알고 대화함
GET  /api/consultations/{id}/messages      → 대화 이력 (새로고침 복원용)
```
- 문항 수는 데이터 파일에 따름 (현재 샘플 5개 → 세종님 콘텐츠 완성 시 35개). 페이징·진행바는 프론트 재량

### SSE 받기 (아바타 응답이 타자 치듯 흘러옴)

`EventSource`는 POST를 못 쓰므로 **fetch 스트림**으로 받으세요:

```js
const res = await fetch(`/api/consultations/${id}/messages`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ content: userText }),
});
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
// 이벤트 형식:  event: token\ndata: {"text":"조각"}\n\n  →  event: done\ndata: {}\n\n
// "event: token"의 data.text를 이어붙여 말풍선에 렌더링, "done"에서 종료
```

## 3. 직무 추천

```
POST /api/recommendations  {consultation_id}
  → 201 {results: [{job_code, job_title, score, reason}]}   상위 3개
  → 409 적성 파악 부족 — body.detail에:
       {reason: "aptitude_unclear", interim_conclusion, followup_questions[], message}
       → 상담 화면으로 돌려보내고 followup_questions로 대화 이어가기 (기획 확정 UX)
```

## 4. 맵 화면 — 시나리오 선택

```
GET /api/scenarios
  → [{slug, title, module, job_code, job_title}]
```
- **module**(8종: 대인응대형/절차·점검형/...)로 **배경 세트 선택**하면 됩니다.
- 돌발 퀘스트 보유 여부는 의도적으로 안 내려줌 (서프라이즈).

## 5. 🎮 게임 (WebSocket)

```
POST /api/simulations  {scenario_slug}  → 시뮬레이션 생성 (아래 응답 구조)
WS   /ws/simulations/{id}?user_id=<선택>
GET  /api/simulations/{id}              → 상태 복원 (새로고침 대응)
POST /api/simulations/{id}/finish       → 중도 포기 (aborted 처리)
```

### 시뮬레이션/스텝 응답 구조
```json
{
  "id": 1, "scenario_slug": "kts-01", "scenario_title": "...", "module": "대인응대형",
  "status": "active", 
  "state": {"step": "m1", "trust": 50, "attempts": {...}, "quest": {...}},
  "step": {
    "id": "m1", "type": "정상업무", "title": "...", 
    "mission": "원무팀장: \"오전 예약 명단이야...\"\n\n예약 명단과...",  ← NPC 대사 포함
    "npcs": ["원무팀장"],          ← 이 스텝에서 대화 가능한 NPC
    "guide": "제공 자료: ...",     ← 기본 조언 카드 / 자료 패널
    "choices": [],                 ← 있으면 선택지 버튼
    "task": {
      "kind": "checklist",         ← 과제 유형 (아래 표 참고) — UI 분기의 핵심
      "prompt": "...",
      "criteria": [...],
      "pass_score": 70,
      "options": [{"key":"a","label":"..."}, ...]  ← kind가 choice/checklist/order일 때만
    }
  }
}
```

### 과제 유형(`task.kind`) — UI 분기

산출물 부담을 줄이기 위해 대부분의 과제는 **클릭·선택·배열**로 답합니다. `options`가 있으면 그 보기로 UI를 그리고, 제출은 **선택한 key 배열**(또는 콤마 문자열)을 `content`로 보냅니다.

| kind | 화면 | 제출 `content` | 예 |
|---|---|---|---|
| `write` | 텍스트 입력 (기존과 동일, 서술형) | 제출물 텍스트 | `"당일 마감... 미결 2건 인계"` |
| `choice` | 라디오(단일 선택) | 고른 key 1개 | `["b"]` 또는 `"b"` |
| `checklist` | 체크박스(복수 선택) | 고른 key들 | `["a","c","d"]` |
| `order` | 드래그 정렬(전체 배열) | 배열한 전체 key 순서 | `["c","a","b","d"]` |

- `choice`/`checklist`/`order`는 **즉시 룰 채점**(LLM 없음) → `task_result`가 바로 옵니다. 코치 카드는 서술형에서만 옵니다.
- `order`는 반드시 **모든 보기**를 배열해 제출해야 합니다(부분 제출 400).
- 정답은 서버에만 있고 `options`엔 없습니다 — 보기 순서는 스포일러 방지로 섞여 있습니다.

### WS 보내기 (클라이언트 → 서버)
| 타입 | 페이로드 | 용도 |
|---|---|---|
| `chat` | `{type:"chat", npc:"원무팀장", content:"..."}` | NPC 대화 |
| `task_submit` | `{type:"task_submit", content:...}` — `content`는 서술형이면 텍스트, 선택·배열형이면 key 배열(`["a","c"]`)/콤마 문자열 | 과제/퀘스트 제출 |
| `choice` | `{type:"choice", choice_id:"postpone"}` | 선택지 |

### WS 받기 (서버 → 클라이언트) — 프레임 순서대로 처리
| 타입 | 내용 | UI 처리 |
|---|---|---|
| `session` | 접속 직후 현재 상태 전체 | 화면 초기화/복원 |
| `token` | `{text}` NPC 응답 조각 | 말풍선에 이어붙이기 |
| `npc_reply` | `{npc, content, delta, state, step_changed}` | 응답 확정, 상태 게이지 갱신 |
| `task_result` | 채점: `{total, passed, scores[], feedback, advice_card, state}` | 결과 표시. **advice_card**(level 1~3, title, content)가 있으면 = 미달 → **AI조언카드 UI** |
| `step_changed` | `{step}` 다음 스텝 정보 | 미션 패널 교체 |
| `sudden_quest` | ⚡ `{npc, intro, task}` | **돌발 퀘스트 연출** (인트로 → 퀘스트 과제 패널) |
| `quest_result` | `{total, passed, ..., quest_status}` | `quest_status`가 `passed`/`failed`면 퀘스트 닫고 본편 복귀 (`active`면 재도전) |
| `state_updated` | 선택지 결과 `{delta, state, step_changed}` | 상태 갱신 |
| `simulation_completed` | 완주! | 결과 화면으로 이동 |
| `coach_cards` | 미션 **통과 시 1회** — AI 코치 사후 리뷰 `{coach_message, cards[], retry_instruction}` | 하단 코치 말풍선(coach_message) + **우측 카드**(cards: 최대 3, card_type별 아이콘 — safety_stop/error_correction/requirement_check/better_expression/success). LLM 여건상 생략될 수 있으니 없어도 UI가 기다리지 말 것 |
| `error` | `{detail}` | 토스트 등 |

⚠️ 퀘스트 진행 중 `task_submit`은 자동으로 **퀘스트 채점**으로 갑니다 (본편 과제 제출 불가).

## 6. 점수 (결과 화면)

```
GET /api/simulations/{id}/score
→ {
    "missions": [{step, type, raw, adjusted, attempts, max_hint_level}],
    "quest": {adjusted, status, ...} | null,
    "mission_avg": 85, "total": 82,
    "competencies": {situation_judgment: 70, ..., collaboration: 63},  // null = 해당 미션 없음
    "percentile": {"sample_size": 12, "top_percent": null}
  }
```
- `top_percent`가 **null이면 백분위 숨김** (완주자 30명 미만 — 정책).
- 진행 중에 호출하면 부분 집계.
- 진행 중 점수 노출 범위(전부/등급만)는 프론트 재량 — API는 다 줍니다.

## 7. 최종 리포트

```
POST /api/reports  {consultation_id, simulation_id?}   → 202 {id, status:"pending"}
GET  /api/reports/{id}          → status 폴링 (pending → done/failed, 1초 간격 권장)
GET  /api/reports/{id}/pdf      → PDF 다운로드
```
- `simulation_id`(완주한 것)를 주면 **최종 적합도 = 상담 50% + 수행 50%** + 역량 표 + 백분위가 리포트에 포함.
- 미완주 시뮬레이션이면 400.

## 8. 기타

- **TTS**: `POST /api/tts {text}` → 오디오 바이너리 (지금은 키가 없어 비프음 wav, 키 들어오면 실제 음성 mp3 — 코드 변경 없이 동일 엔드포인트)
- **에러 형식**: 전부 `{detail: "메시지"}` (409 게이트만 detail이 객체 — §3 참고)
- **CORS**: localhost:5173(Vite)·3000 허용돼 있음
- 문의: 백엔드 김태수
