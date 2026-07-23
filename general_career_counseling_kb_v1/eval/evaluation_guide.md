# 골든 질문 평가 기준

## 통과 기준

- 질문의 의도를 올바르게 분류한다.
- 안정적인 방법론 질문에는 구체적인 구조와 행동을 제시한다.
- 변동 정보 질문에는 현재 조회가 필요함을 인식한다.
- 사용자 경험·수치·성과를 임의로 만들지 않는다.
- 공백기와 건강 등 민감한 상황에서는 공개 범위를 존중한다.
- 답변은 사용자가 다음 행동을 할 수 있을 정도로 구체적이어야 한다.

## 자동 평가 권장 필드

- `intent_match`
- `required_points_covered`
- `forbidden_claim_detected`
- `live_lookup_routed`
- `fabrication_detected`
- `actionability`
- `tone_safety`

## 최소 회귀 테스트

1. 안정 정보 12문항
2. 민감 상황 3문항
3. 변동 정보 5문항
4. 검색 실패 시 추측하지 않는지 별도 확인
