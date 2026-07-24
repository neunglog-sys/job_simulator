"""시뮬레이션 state에서 **엔진이 소유하는 키** 목록.

state는 시나리오 YAML의 initial_state(직무별 상태값)와 엔진이 쓰는 진행 정보가 한 dict에
섞여 있다. 둘을 구분하는 기준이 필요한 곳이 두 군데인데, 각자 자기 목록을 들고 있다가
어긋났다:

- content.loader: initial_state가 엔진 키를 덮어쓰지 못하게 막는 가드
- scoring.aggregate: 역량 점수에 섞을 '상태값'을 고를 때 엔진 키를 빼야 함

한쪽만 갱신되면 조용히 틀린다. 실제로 aggregate가 coach_streak(대화 턴 카운터)을
0~100 점수로 오인해 역량 점수를 끌어내렸다. 엔진 키를 새로 추가할 때는 여기만 고친다.

core에 두는 이유: content ↔ scoring, simulation → scoring 의존이 이미 있어서 어느 도메인에
두든 순환이 생긴다. core는 도메인을 참조하지 않으므로 양쪽이 안전하게 가져다 쓸 수 있다.
"""

# 엔진이 읽고 쓰는 키. 시나리오가 initial_state로 정의할 수 없고,
# 역량 점수의 '상태값 평균'에도 들어가지 않는다.
ENGINE_STATE_KEYS = frozenset(
    {
        "step",          # 현재 스텝 id
        "attempts",      # 스텝별 제출 횟수
        "quest",         # 돌발 퀘스트 진행
        "coach_streak",  # 진전 없이 이어진 대화 턴 수 (점수가 아니라 카운터)
        "minigame",      # 마지막 미니게임 결과
        "minigames",     # 엔진별 미니게임 결과
        "met_npcs",      # 만난 NPC 목록
        "tour_done",     # 투어 완료 여부
        "memo",          # 플레이어 메모
        "reflection",    # 회고
        "score",         # 집계 점수
    }
)
