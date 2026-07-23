# 일반 진로상담 KB v1

작성일: 2026-07-23

## 목적

기존 직무 프로세스 중심 KB에 아래 일반 취업상담 영역을 추가하기 위한 1차 자료팩입니다.

- 포트폴리오 구성
- 이력서 작성과 점검
- 면접 STAR 답변
- 공백기와 직무전환
- 취업 준비 로드맵
- 최신 채용·연봉·자격 정보의 안전 응답 정책

## 폴더

- `kb/`: 사람이 검토하기 쉬운 주제별 Markdown
- `rag/general_career_counseling.jsonl`: RAG 적재용 청크 31개
- `eval/golden_questions.json`: 회귀 평가용 골든 질문 20개
- `eval/evaluation_guide.md`: 평가 기준
- `prompt/volatile_fact_guard.md`: 변동 정보 안전 가드 문구
- `sources/`: 출처와 검토 주기

## 권장 적용 순서

1. `prompt/volatile_fact_guard.md`를 현재 상담 프롬프트에 반영한다.
2. `kb/` 내용을 팀이 사실성·말투 관점에서 검토한다.
3. `rag/*.jsonl`을 별도 컬렉션 또는 `general_career_counseling` 도메인으로 적재한다.
4. 검색 결과에 `requires_live_lookup=true`가 포함되면 실시간 조회 라우터로 보낸다.
5. 골든 질문을 기존 상담 테스트에 추가한다.
6. 최신 정보 5문항은 검색 미사용 상태에서 수치를 생성하지 않는지 먼저 검증한다.

## 데이터 설계 포인트

- 안정 지식과 변동 지식을 분리했습니다.
- 각 청크에 `stability`, `requires_live_lookup`, `source_ids`, `last_reviewed`를 포함했습니다.
- 변동 정보 청크는 사실값이 아니라 검증 절차만 제공합니다.
- 사용자 경험과 성과를 창작하지 않도록 평가 항목을 넣었습니다.

## 제한

- 이 팩은 일반 진로·취업 상담용입니다.
- 특정 개인의 법률·의료 문제에 대한 전문 판단을 제공하지 않습니다.
- 회사별 최신 전형, 채용 수치, 연봉, 시험 일정은 별도 실시간 확인이 필요합니다.
