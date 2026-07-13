# 상담 데이터팩 출처 등록부 (Source Registry)

작성일: 2026-07-13

이 문서에 없는 `source_id`는 `data/counseling/*.json`에서 사용할 수 없다.
`scripts/validate_counseling_data.py`(repo root 실행)가 이를 강제하며,
`tests/backend/test_counseling_data.py`의 `test_all_source_ids_registered`도 이 문서에
접근 가능한 환경(로컬/CI)에서 동일하게 검증한다 — Docker 컨테이너는 `docs/`를
마운트하지 않으므로 그 환경에서는 이 테스트가 스킵된다.

공식 심리검사 문항(고용24, O*NET)은 **어디에서도 그대로 복제하지 않았다.** 아래
데이터팩(`question_bank.json` 등)의 질문 문구는 전부 이 문서에 적힌 "사용한 개념"만
참고해 새로 작성한 것이며, 원문 대조 결과는 `scripts/manual_review_official_overlap.md`
(수동 검수 목록, §"14. 테스트" 참고)에 남긴다.

---

### SRC-NCS-CAREER-DIAGNOSIS

- **기관**: 한국산업인력공단 (NCS 국가직무능력표준)
- **자료명**: NCS 직업상담서비스 — 직업상담 진단 (능력단위)
- **URL**: https://www.ncs.go.kr
- **사용한 개념**: 상담 초기 "문제/고민 진단" 단계 구조, 상담 목적 확인 절차
- **서비스 적용 위치**: `question_bank.json` phase `intake_purpose`,
  `counseling_process.md` 1~2단계
- **직접 복제 여부**: 없음 — NCS 능력단위 요소의 절차 개념만 참고, 문항 텍스트 없음
- **라이선스·주의사항**: NCS 자료는 공공 활용 목적으로 공개되어 있으나 능력단위
  세부 체크리스트를 그대로 전재하지 않았음. 정확한 하위 경로는 ncs.go.kr 내
  "직업상담서비스" 검색으로 재확인 필요(사이트 개편으로 URL 변동 가능).
- **확인일**: 2026-07-13

### SRC-NCS-INITIAL-INTERVIEW

- **기관**: 한국산업인력공단 (NCS)
- **자료명**: NCS 직업상담서비스 — 직업상담 초기면담
- **URL**: https://www.ncs.go.kr
- **사용한 개념**: 초기면담에서 다루는 정보 범주(호소 문제, 경력·경험, 제약조건)의
  분류 방식
- **서비스 적용 위치**: `question_bank.json` phase `intake_purpose`,
  `experience_exploration`; `dimension_definitions.json`의 `constraint.*` 그룹
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-NCS-REMOTE-COUNSEL

- **기관**: 한국산업인력공단 (NCS)
- **자료명**: NCS 직업상담서비스 — 비대면 직업상담
- **URL**: https://www.ncs.go.kr
- **사용한 개념**: 비대면(텍스트/화상) 상담에서 "한 번에 하나씩" 확인하는 진행 원칙 —
  본 프로젝트의 아바타 상담(텍스트 SSE) 구조와 매체가 유사해 대화 진행 규범만 참고
- **서비스 적용 위치**: `safety_rules.json`, `avatar/system.md`의 "한 번에 질문 하나" 원칙
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-NCS-CAREER-GUIDANCE

- **기관**: 한국산업인력공단 (NCS)
- **자료명**: NCS 직업상담서비스 — 진로상담
- **URL**: https://www.ncs.go.kr
- **사용한 개념**: 진로상담의 "탐색 → 잠정 결론 → 확인" 흐름
- **서비스 적용 위치**: `counseling_process.md` 전체 흐름, `recommendation_gate_rules.json`
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-NCS-JOB-INFO-ANALYSIS

- **기관**: 한국산업인력공단 (NCS)
- **자료명**: NCS 직업상담서비스 — 직업정보 분석·제공
- **URL**: https://www.ncs.go.kr
- **사용한 개념**: 직업정보를 사용자에게 "단정이 아닌 근거 제시형"으로 전달하는 원칙
- **서비스 적용 위치**: `safety_rules.json` 금지/권장 표현 쌍, `recommendation/extract.md`
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-WORK24-CAREER-PREF-S

- **기관**: 고용노동부·한국고용정보원 (고용24)
- **자료명**: 대학생·성인 직업심리검사 — 직업선호도검사 S형
- **URL**: https://www.work24.go.kr (고용24 홈 > 직업·진로 > 직업심리검사)
- **사용한 개념**: RIASEC(홀랜드 6유형) 흥미 범주 구조 — S형이 다루는 "흥미검사" 영역의
  분류 개념만 사용
- **서비스 적용 위치**: `dimension_definitions.json`의 `interest.*` 6종,
  `module_mapping.json`의 RIASEC→모듈 초기 가중치
- **직접 복제 여부**: **없음.** 검사 문항·채점 알고리즘을 조회·복제하지 않았고,
  자유대화 질문(`question_bank.json`)은 전부 새로 작성
- **라이선스·주의사항**: 공식 검사는 국가 공인 심리검사로, 본 서비스의 대화 추론
  결과를 이 검사의 결과인 것처럼 표현하지 않는다(`safety_rules.json` 참고). 정식
  검사가 필요한 사용자는 고용24 원 서비스로 안내하는 것을 권장(현재 코드에는
  안내 문구 없음 — 후속 과제로 기록만 남김).
- **확인일**: 2026-07-13

### SRC-WORK24-CAREER-PREF-L

- **기관**: 고용노동부·한국고용정보원 (고용24)
- **자료명**: 대학생·성인 직업심리검사 — 직업선호도검사 L형
- **URL**: https://www.work24.go.kr
- **사용한 개념**: L형이 흥미검사에 더해 다루는 "성격·생활사" 범주가 업무 방식
  선호(`work_style.*`)와 개념적으로 겹치는 지점만 참고
- **서비스 적용 위치**: `dimension_definitions.json`의 `work_style.*` 7종
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-WORK24-VALUES

- **기관**: 고용노동부·한국고용정보원 (고용24)
- **자료명**: 대학생·성인 직업심리검사 — 직업가치관검사
- **URL**: https://www.work24.go.kr
- **사용한 개념**: 직업가치관 하위요인 분류(사회적 인정, 성취, 보상, 안정성 등)의
  범주 구조
- **서비스 적용 위치**: `dimension_definitions.json`의 `work_value.*` 9종
- **직접 복제 여부**: 없음 — 하위요인 "이름의 개념"만 참고했고 문항·척도는 사용하지 않음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-WORK24-APTITUDE

- **기관**: 고용노동부·한국고용정보원 (고용24)
- **자료명**: 대학생·성인 직업심리검사 — 직업적성검사
- **URL**: https://www.work24.go.kr
- **사용한 개념**: "적성"과 "흥미"를 별개 축으로 분리해서 다루는 설계 원칙(잘하는 것과
  좋아하는 것을 혼동하지 않음) — 품질 검수 시나리오 3번(엑셀은 잘하지만 싫음)의 근거
- **서비스 적용 위치**: `evidence_rules.json`(skill vs interest 근거 분리),
  `safety_rules.json`(능력만으로 추천 확정 금지)
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-WORK24-JOB-READINESS

- **기관**: 고용노동부·한국고용정보원 (고용24)
- **자료명**: 대학생·성인 직업심리검사 — 구직준비도검사
- **URL**: https://www.work24.go.kr
- **사용한 개념**: 현실 제약조건(구직 준비도의 "환경적 장벽" 범주)을 별도 축으로 다루는
  구조
- **서비스 적용 위치**: `dimension_definitions.json`의 `constraint.*` 7종
- **직접 복제 여부**: 없음
- **라이선스·주의사항**: 위와 동일
- **확인일**: 2026-07-13

### SRC-ONET-INTEREST-PROFILER

- **기관**: 미국 노동부 O*NET (O*NET Interest Profiler)
- **자료명**: O*NET Interest Profiler (RIASEC 구조)
- **URL**: https://www.onetonline.org/explore/ip/ (O*NET Interest Profiler 소개 페이지;
  정확한 URL은 O*NET 사이트 개편으로 변동될 수 있어 실사용 전 재확인 필요)
- **사용한 개념**: RIASEC(Realistic·Investigative·Artistic·Social·Enterprising·
  Conventional) 6유형 정의 구조 **개념만** 사용
- **서비스 적용 위치**: `dimension_definitions.json`의 `interest.*` 6종
- **직접 복제 여부**: **없음 — 공식 문항을 임의 번역·변형해서 정식 검사처럼 제공하지
  않는다.** `question_bank.json`의 흥미 관련 질문은 O*NET 문항을 참고 번역한 것이
  아니라, RIASEC 정의(개념)에서 출발해 완전히 새로 작성한 자유대화형 질문이다.
- **라이선스·주의사항**: O*NET Interest Profiler는 미국 정부 저작물이나, 도구를
  **직접(자동화된 형태로) 사용**하려면 O*NET 라이선스 조건(출처 표기, 상표 사용
  제한 등)을 별도로 검토해야 한다. 본 프로젝트는 도구 자체를 임베드하거나 재배포하지
  않고 RIASEC 개념 구조만 차용했으므로 별도 라이선스 절차를 거치지 않았다 — 만약
  향후 O*NET 문항을 직접 인용/번역하는 방향으로 확장한다면 그 시점에 라이선스
  재검토가 필요하다.
- **확인일**: 2026-07-13

### SRC-OARS

- **기관**: 미국 SAMHSA (Substance Abuse and Mental Health Services Administration)
- **자료명**: OARS (Open questions, Affirmations, Reflective listening, Summarization) —
  동기강화상담(Motivational Interviewing) 핵심 기법
- **URL**: https://www.samhsa.gov (정확한 하위 문서 경로는 SAMHSA 발간 자료 목록에서
  "motivational interviewing" 검색으로 재확인 필요)
- **사용한 개념**: 개방형 질문(Open) / 인정하기(Affirmations) / 반영적 경청
  (Reflective listening) / 요약(Summarization) 4요소를 상담 흐름 설계에 반영 —
  특히 `avatar/system.md`의 "짧게 공감 후 다음 질문"(Affirmation+Open), 중간결론
  발화(Summarization)
- **서비스 적용 위치**: `counseling_process.md`, `question_bank.json`의
  `question_type: "open"` 필드, `followup_rules.json`의 반영적 경청 유형 규칙
- **직접 복제 여부**: 없음 — 기법 프레임워크만 차용
- **라이선스·주의사항**: SAMHSA 자료는 미국 연방정부 공공 저작물로 개념 인용에
  제약이 없으나, 본 프로젝트가 의료·정신건강 서비스가 아님을 분명히 해야 함
  (`safety_rules.json`의 위기 상황 라우팅 규칙과 함께 사용).
- **확인일**: 2026-07-13

---

## 요약 원칙 (모든 출처 공통)

1. 공식 심리검사(고용24, O*NET) 문항을 그대로 번역·복제해 정식 검사처럼 제공하지 않는다.
2. 대화 추론 결과는 "성향 가설"이며 공식 검사 결과와 구분해 표현한다
   (`safety_rules.json` §"공식 검사 결과와 대화 추론 결과를 구분").
3. NCS 자료는 상담 "절차 구조"(진단→초기면담→진로상담→정보제공)만 참고하고
   능력단위 체크리스트를 그대로 전재하지 않는다.
4. OARS는 대화 기법 프레임워크로만 사용하고, 본 서비스가 심리상담·의료행위가
   아님을 안전규칙에 명시한다.