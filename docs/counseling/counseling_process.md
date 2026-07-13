# 상담 프로세스 매핑

작성일: 2026-07-13

## 0. 전제: 현재 코드에는 "상담 단계 상태머신"이 없다

`services/api/app/domains/simulation/state_machine.py`는 **시뮬레이션(게임엔진) 도메인**의
스텝 전이 상태머신이며, 상담(`consultation`) 도메인과는 무관하다(grep 결과: `state_machine`은
`domains/simulation/`에만 존재). 상담 도메인이 실제로 갖고 있는 상태는:

- `Consultation.status`: `active | completed` — 딱 두 값.
- 대화 진행 자체는 상태값이 아니라 **`avatar/system.md`의 자유서술 지시문**이
  LLM에게 "무엇을 파악했는지 스스로 판단해서 다음 질문·중간결론·마무리를 결정"하게
  맡기는 구조 (PR #7).
- 게이트 판정은 상담 세션 상태가 아니라 `/api/recommendations` 호출 시점에 별도로
  1회 계산되는 `aptitude_clarity` 값이다 (`recommendation/service.py`).

따라서 이 문서의 "매핑"은 **DB 상태값 매핑이 아니라, `avatar/system.md` 프롬프트
지시문 + `question_bank.json`의 `phase` 필드가 담당하는 논리적 단계 매핑**이다.
새로운 DB 상태나 API 스텝을 추가하지 않았다.

## 1. 목표 흐름 → 현재 구조 매핑

| 목표 흐름 | 현재 구현이 이 역할을 하는 지점 | 이번 작업에서 추가한 것 |
|---|---|---|
| 상담 안내·동의 | 없음 — 프론트가 상담 시작 전 안내 화면을 별도로 가짐(코드 확인 범위 밖) | `safety_rules.json`에 안내 문구 원칙만 문서화 (UI 구현은 프론트 담당) |
| 현재 고민과 상담 목적 확인 | `avatar/system.md` 대화 목표 §"성향/관심사/강점/업무선호" 중 명시적 "상담 목적" 항목 없음 | `question_bank.json` phase `intake_purpose` 신설 (LLM이 참고할 질문 예시) |
| 구체적인 경험 탐색 | `avatar/system.md` §"적성을 잘 모르는 사용자 대응" — 이미 "최근 시간 가는 줄 모르고 했던 일" 같은 경험 질문 예시 있음 | `question_bank.json` phase `experience_exploration`으로 예시를 체계화 + `evidence_rules.json`으로 근거 신뢰도 규칙 부여 |
| 흥미·업무대상·업무방식·가치관·제약조건 가설 생성 | `recommendation/extract.md`가 상담 종료 후 한 번에 `interests/strengths/competency_scores`로 추출(사후 일괄 처리) | `dimension_definitions.json`(43개 축)으로 세분화된 "가설" 어휘 제공. **추출 스키마 자체는 변경하지 않음**(§"연결 지점" 참고) |
| 불확실·충돌 축 추가 질문 | `avatar/system.md`에 "모르겠어요" 대응만 있고, 축 간 충돌(예: 흥미 vs 제약조건) 대응 지시는 없음 | `followup_rules.json` 신설 — `select_next_question()`이 참고할 규칙(연속 질문 상한 2회 포함) |
| AI 중간요약 | `avatar/system.md` §"중간 결론" — 이미 필수 발화로 지시되어 있음 (요약+모호한 점 1가지) | 문구는 유지, `safety_rules.json`의 "가설로 표현" 원칙을 보강 문장으로 추가 |
| 사용자 확인·수정 | 코드 레벨 확인 UI 없음 — 409 게이트 실패 시 프론트가 상담 화면으로 복귀시키는 것이 사실상 유일한 "재확인" 경로(PR #7 본문) | 범위 밖(프론트 담당) — 문서화만 |
| 추천 게이트 판정 | `recommendation/service.py`의 `aptitude_clarity < 50` → 409 (스칼라 단일 임계값) | `recommendation_gate_rules.json`에 **목표 다축 게이트를 데이터로 정의**하고 `evaluate_gate()`로 구현하되, 실제 라우터의 게이트 로직은 바꾸지 않음(§16 참고) |
| 상위 모듈·중분류 추천 | 없음 — 현재 추천은 `jobs` 테이블(2건) 기준 | `module_mapping.json` + `map_to_modules()` 신설. **`/api/recommendations` 응답에는 아직 포함되지 않음** — 순수 유틸리티로만 추가 |
| 기존 대표 미션 연결 | 없음 — `team_rep_missions`는 아직 참조되지 않음 | `module_mapping.json`이 `TeamRepMission.mission_code` 값을 그대로 참조 (재생성 없음) |

## 2. 프롬프트 레벨 흐름 (실제 LLM에게 주어지는 지시 기준)

```
[avatar/system.md 1회 시스템 프롬프트, 매 턴 재사용]
 ├─ 목표: 성향/관심사/강점/업무선호 파악
 ├─ 규칙: 질문 하나씩, 3문장 이내, 존댓말
 ├─ 적성 모르는 사용자 대응: 경험 기반 질문으로 파고들기
 ├─ (신규, 이번 작업) 안전 규칙 요약: 단정 금지·가설 표현·확정 진단 아님
 └─ 중간 결론 필수 발화 → 마무리 멘트

[recommendation/extract.md, /api/recommendations 호출 시 1회]
 ├─ 대화 전체를 스캔해 competency_scores/interests/strengths/summary 추출
 ├─ aptitude_clarity 판정 (0~100)
 └─ 50 미만 → 409 + interim_conclusion + followup_questions (상담으로 복귀)
     50 이상 → Job 매칭 상위 3개 반환, consultation.status = completed
```

## 3. 이번 작업이 새로 만들지 않은 것 (명시)

- 상담 진행 단계를 나타내는 새 DB 컬럼/상태값 — 만들지 않음.
- `/api/consultations/*` 요청·응답 스키마 변경 — 없음.
- "다음 질문 선택"을 위한 별도 LLM 호출(현재는 `avatar/system.md` 1회 프롬프트 안에서
  암묵적으로 처리됨) — 새 LLM 호출 단계를 추가하지 않았다. `select_next_question()`은
  **LLM이 아니라 규칙 기반 순수 함수**로, 향후 `avatar/system.md`에 힌트를 주입하는
  용도로 준비된 유틸리티다(현재는 안전 규칙 텍스트만 실제로 주입, §16 참고).
- 추천 게이트의 실제 임계값/응답 형태 변경 — 없음. `recommendation_gate_rules.json`은
  "목표 상태"를 문서화한 것이며 라이브 게이트를 대체하지 않는다.
