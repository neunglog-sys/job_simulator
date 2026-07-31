# 직무별 NPC 오버라이드

이 폴더의 `J*.yaml` 103개는 family 공통 페르소나에 결합하는 직무별 데이터다.
직접 수정하기보다 `python scripts/generate-npc-job-overrides.py`로 다시 생성한다.

## 결합 순서

1. `data/prompts/npc/system.md`: 모든 NPC의 역할 경계
2. `data/prompts/npc/personas/F*.md`: family 공통 성격·말투·권한
3. 이 폴더의 `prompt_contract.npc_visible`: 직무별 업무대상·NPC·산출물
4. 선택한 `content_variants[*].stages/missions[*].npc_visible`: 현재 단계·미션 정보

`coach_private`와 `scorer_private`는 NPC 프롬프트에 넣지 않는다. 전자는 AI 코치,
후자는 채점 서비스에만 전달한다.

## 검수 상태

- `integrated_research`: 통합조사 연결맵·단계·미션을 병합한 직무
- `researched_needs_human_review`: 미연결 31개 직무를 공식 자료로 보강한 초안

보강 원문과 출처는 `data/research/npc-job-overrides-researched.yaml`에 있다.
