# 공식 검사 문항 중복 여부 수동 검수 목록

이 파일은 `scripts/validate_counseling_data.py`가 자동 생성한다(수동 편집 시 다음 실행에서 덮어써짐).
각 질문이 고용24 직업심리검사·O*NET Interest Profiler 공식 문항을 그대로 번역/복제한 것이
아님을 검수자가 원문과 대조해 체크한다. 신규 질문 추가 시 이 목록도 함께 갱신해야 한다.

| 확인 | question_id | 질문 | 참고 출처 |
|---|---|---|---|
| [ ] | CQ-PUR-001 | 오늘 상담에서 가장 궁금하거나 고민되는 걸 편하게 말씀해주시겠어요? | SRC-NCS-CAREER-DIAGNOSIS, SRC-NCS-CAREER-GUIDANCE |
| [ ] | CQ-PUR-002 | 지금 상황에서 가장 답답하거나 막막한 부분은 어떤 건가요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-PUR-003 | 이번 상담을 통해 어떤 걸 얻어가면 만족스러우실 것 같으세요? | SRC-NCS-CAREER-GUIDANCE, SRC-OARS |
| [ ] | CQ-EXP-001 | 최근에 시간 가는 줄 모르고 했던 일이나 작업이 있었나요? | SRC-NCS-INITIAL-INTERVIEW, SRC-OARS |
| [ ] | CQ-EXP-002 | 그 상황에서 구체적으로 어떤 행동을 하셨고, 결과는 어땠나요? | SRC-OARS |
| [ ] | CQ-EXP-003 | 학교나 아르바이트, 프로젝트에서 주변 사람에게 칭찬받았던 순간이 있나요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-EXP-004 | 반대로, 하다가 유독 하기 싫었거나 힘들었던 일은 무엇이었나요? | SRC-OARS |
| [ ] | CQ-INT-R-001 | 손으로 직접 만들거나 몸을 움직여서 결과를 확인하는 작업이 재미있었던 적 있나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-INT-I-001 | 궁금한 게 생기면 원인을 끝까지 파고들어 알아본 경험이 있나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-INT-A-001 | 글, 그림, 영상, 디자인처럼 무언가를 새로 만들어내는 활동에 끌린 적이 있나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-INT-S-001 | 누군가를 돕거나 가르쳐서 그 사람이 나아지는 걸 볼 때 어떤 기분이 드나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-INT-E-001 | 사람들을 설득하거나 이끌어서 무언가를 성사시킨 경험이 있나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-INT-C-001 | 정해진 규칙이나 기준대로 자료를 정리·점검하는 일을 할 때 편안함을 느끼나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-TGT-001 | 일할 때 사람을 직접 상대하는 편이 좋으신가요, 혼자 처리하는 편이 좋으신가요? 이유도 궁금해요. | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-TGT-002 | 숫자나 통계 자료를 보고 패턴을 찾아내는 작업을 해본 적 있나요? 그때 느낌이 어땠나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-TGT-003 | 문서나 계약서처럼 정확하게 기록·검토하는 작업을 맡았을 때 어떠셨나요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-TGT-004 | 새로운 아이디어를 구상하고 기획하는 일과, 이미 정해진 걸 정확히 실행하는 일 중 어느 쪽이 편하세요? | SRC-WORK24-CAREER-PREF-L |
| [ ] | CQ-TGT-005 | 기계나 장비, 도구를 다루고 상태를 점검하는 일에 흥미를 느낀 적이 있나요? | SRC-ONET-INTEREST-PROFILER |
| [ ] | CQ-TGT-006 | 실내에서 차분히 일하는 것과 현장·야외에서 몸을 움직이며 일하는 것 중 어느 쪽이 끌리세요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-STY-001 | 정해진 순서와 절차대로 일하는 게 편하신가요, 그때그때 상황에 맞춰 유연하게 일하는 게 편하신가요? | SRC-WORK24-CAREER-PREF-L |
| [ ] | CQ-STY-002 | 매번 비슷한 일을 반복하는 것과 새로운 문제를 계속 만나는 것 중 어느 쪽이 덜 지루하세요? | SRC-WORK24-CAREER-PREF-L |
| [ ] | CQ-STY-003 | 여러 사람과 함께 협업할 때와 혼자 몰입해서 처리할 때, 어느 쪽에서 더 좋은 결과를 냈던 것 같으세요? | SRC-WORK24-CAREER-PREF-L |
| [ ] | CQ-STY-004 | 사무실에 앉아 일하는 것과 현장을 돌아다니며 일하는 것, 상상해보면 어느 쪽이 더 맞는 것 같으세요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-STY-005 | 마감이나 시간 압박이 있는 상황에서 오히려 집중이 잘 되는 편인가요, 힘든 편인가요? | SRC-WORK24-JOB-READINESS |
| [ ] | CQ-STY-006 | 작은 오류나 오탈자를 잘 찾아내는 편인가요? 그런 경험이 있다면 말씀해주세요. | SRC-WORK24-APTITUDE |
| [ ] | CQ-STY-007 | 누군가 세세히 지시해주는 게 편하신가요, 스스로 방향을 정해서 진행하는 게 편하신가요? | SRC-WORK24-CAREER-PREF-L |
| [ ] | CQ-VAL-001 | 일을 통해 누군가에게 도움이 되고 있다는 걸 느끼는 게 나에게 얼마나 중요한가요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-002 | 익숙한 방식을 유지하는 것과 계속 새로운 방식을 시도하는 것, 어느 쪽에 더 끌리세요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-003 | 눈에 보이는 성과나 목표 달성이 나에게 얼마나 큰 동기부여가 되나요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-004 | 직업을 고를 때 보상(급여·처우)이 다른 조건보다 우선순위가 높은 편인가요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-005 | 새로운 걸 계속 배우고 성장한다는 느낌이 일에서 얼마나 중요한가요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-006 | 일과 개인 시간의 균형이 나에게 얼마나 중요한 가치인가요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-007 | 내가 한 일을 주변에서 인정해주는 게 나에게 중요한 편인가요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-008 | 일하는 방식과 순서를 스스로 결정할 수 있는 게 나에게 얼마나 중요한가요? | SRC-WORK24-VALUES |
| [ ] | CQ-VAL-009 | 안정적으로 오래 다닐 수 있는 것과 도전적이지만 변동이 큰 것, 어느 쪽에 더 마음이 가나요? | SRC-WORK24-VALUES |
| [ ] | CQ-SKL-001 | 낯선 사람에게 무언가를 설명하거나 설득해서 잘 전달됐던 경험이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-002 | 다른 사람이 놓친 실수나 오류를 먼저 발견했던 경험이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-003 | 자료를 정리하다 어떤 경향이나 패턴을 스스로 찾아낸 적이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-004 | 여러 사람의 일정이나 역할을 조율해본 경험이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-005 | 무언가를 처음부터 직접 만들거나 기획해서 완성해본 적이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-006 | 특정 장비, 프로그램, 도구를 능숙하게 다뤄본 경험이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-007 | 위험하거나 잘못될 수 있는 상황을 미리 알아채고 대응했던 경험이 있나요? | SRC-WORK24-APTITUDE |
| [ ] | CQ-SKL-008 | 여러 일이 한꺼번에 몰렸을 때 무엇부터 처리할지 스스로 판단해본 경험이 있나요? | SRC-WORK24-APTITUDE, SRC-WORK24-JOB-READINESS |
| [ ] | CQ-CON-001 | 야간·교대 근무 가능 여부에 건강이나 생활 패턴상 제약이 있으신가요? | SRC-NCS-INITIAL-INTERVIEW, SRC-WORK24-JOB-READINESS |
| [ ] | CQ-CON-002 | 현장 근무(이동이 잦거나 실외 활동이 많은 근무)가 가능한 상황이신가요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-CON-003 | 출퇴근 가능한 지역이나 이동 범위에 제약이 있으신가요? | SRC-WORK24-JOB-READINESS |
| [ ] | CQ-CON-004 | 취업 전 별도 교육·훈련 기간을 감수할 수 있는 상황이신가요? | SRC-WORK24-JOB-READINESS |
| [ ] | CQ-CON-005 | 특정 자격증이나 면허가 필요한 직무도 준비할 의향이 있으신가요, 아니면 지금 바로 시작 가능한 쪽을 원하세요? | SRC-WORK24-JOB-READINESS |
| [ ] | CQ-CON-006 | 체력적으로 부담이 큰 업무(장시간 서서 일하기, 무거운 물건 다루기 등)에 제약이 있으신가요? | SRC-NCS-INITIAL-INTERVIEW |
| [ ] | CQ-CON-007 | 낯선 사람을 계속 응대해야 하는 업무가 체력적·심리적으로 부담되는 편인가요? | SRC-NCS-INITIAL-INTERVIEW, SRC-WORK24-JOB-READINESS |
| [ ] | CQ-SUM-001 | 지금까지 정리해보면 [요약 내용]인 것 같아요. 제가 맞게 이해한 걸까요? 다르게 느끼는 부분이 있다면 알려주세요. | SRC-NCS-CAREER-GUIDANCE, SRC-OARS |
| [ ] | CQ-SUM-002 | 혹시 제가 놓쳤거나 다르게 알고 있는 부분이 있을까요? | SRC-OARS |
| [ ] | CQ-EXT-001 | 이 직무들 중에 먼저 체험해보고 싶은 게 있으신가요? 실제로 해보면서 맞는지 확인해볼 수 있어요. | SRC-NCS-CAREER-GUIDANCE |
| [ ] | CQ-EXT-002 | 추천 이유 중에 와닿지 않는 부분이 있다면 말씀해주세요. 다시 조정해볼게요. | SRC-OARS |
