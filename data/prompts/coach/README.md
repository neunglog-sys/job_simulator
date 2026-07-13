# AI coach prompt contract

AI 코치는 NPC와 분리된 평가·교정 계층이다.

| 역할 | NPC | AI 코치 |
|---|---|---|
| 직장 일상대화 | 가능 | 불필요 |
| 업무 지시·요청 | 담당 | 담당하지 않음 |
| 사용자 오류 설명 | 금지 | 담당 |
| 평가기준·누락 설명 | 금지 | 담당 |
| 개선 표현 예시 | 금지 | 담당 |
| 안전 위험 중단 | 즉시 지시 | 이유·기준·대안 설명 |
| 점수 계산 | 금지 | 금지, 백엔드 담당 |

`system.md`는 다음 입력을 요구한다.

- `mission`
- `request_id`, `run_id`, `mission_id`, `stage_id`
- `current_stage`
- `locked_rules`
- `user_action`
- `validation_result`
- `rubric`
- `retrieved_context`

LLM 호출은 `response-schema.json`을 구조화 출력 계약으로 전달한다. 입력 식별자는 출력에서 그대로 교차검증한다. 하단 코치 말풍선은 `coach_message`, 우측 상세 카드는 `cards`, 재시도 버튼은 `retry_instruction`을 사용한다.

화면 연동 예시는 `example-response.json`을 참고한다. 이미지의 빨간 오류 카드, 노란 요구사항 카드, 초록 개선 표현 카드를 한 응답에 담은 예시다.

카드 색상 권장 매핑:

| card_type | 색상 |
|---|---|
| `safety_stop` | red |
| `error_correction` | red |
| `requirement_check` | yellow |
| `better_expression` | green |
| `success` | green |
