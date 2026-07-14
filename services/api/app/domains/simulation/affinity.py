"""NPC 호감도 — 룰 기반(순수 함수). 미연시가 아니라 감정선은 거칠게, 태도만 반영.

- NPC별로 사용자에 대한 호감도(0~100)를 가진다. 기본 50에서 시작.
- 대화 한 턴마다 사용자 발화의 '태도'로 그 NPC 호감도만 가감한다(양방향).
  올라가기보다 내려가기가 크다 — 신뢰는 천천히 쌓이고 무례는 빨리 깎이게(비대칭).
- 호감도는 프롬프트에서 '말의 온기·협조 태도'에만 반영한다. 반말/존대 화법과
  '정답을 대신 알려주지 않는다'는 규칙은 호감도와 무관하게 항상 유지(#42).

저장 위치는 Simulation.state["affinity"] = {npc_id: value} (JSONB, 마이그레이션 불필요).
state_machine.apply_deltas는 dict 값 키를 건너뛰므로 시나리오 상태값과 충돌하지 않는다.
"""

import re

BASE = 50  # 첫 대면 호감도 (중립)
MIN, MAX = 0, 100

# 무례·적대 (강한 하락)
_HOSTILE = re.compile(
    r"씨발|시발|ㅅㅂ|병신|ㅄ|닥쳐|꺼져|개소리|멍청|바보|엿먹|미친놈|미친년|좆|ㅈ같|한심"
)
# 정답을 대신 달라는 요구 (스푼피딩 — NPC가 싫어함, 하락)
_SPOONFEED = re.compile(
    r"정답|답\s*(좀|을|이|알려|찍)|그냥\s*(해|알려|답)|대신\s*(해|써|작성|정리)|모범답안|풀어\s*줘|찍어\s*줘"
)
# 정체·규칙 캐묻기 / 게임 메타 (몰입 깨기, 소폭 하락)
_META = re.compile(
    r"프롬프트|시스템\s*프롬|너\s*(뭐|정체|누구|이름)|규칙\s*(뭐|알려|공개)|ai\s*(냐|야|임)|봇\s*(냐|야|임)",
    re.IGNORECASE,
)
# 공손·긍정 (상승)
_POLITE = re.compile(
    r"감사|고맙|고마워|부탁|죄송|알겠습니다|알겠어요|확인하겠|여쭤|여쭙|수고|please", re.IGNORECASE
)

# 턴당 변동 폭 — 무례(-)가 공손(+)보다 크게(비대칭).
_MIN_DELTA, _MAX_DELTA = -6, 3


def current(state: dict, npc_id: str) -> int:
    """이 NPC에 대한 현재 호감도. 아직 대화 전이면 기본값(BASE)."""
    return int((state.get("affinity") or {}).get(npc_id, BASE))


def delta_for(user_text: str) -> int:
    """사용자 발화 한 턴의 태도 → 호감도 변화량. [-6, +3] 클램프."""
    text = (user_text or "").strip()
    if not text:
        return 0
    delta = 0
    if _HOSTILE.search(text):
        delta -= 6
    if _SPOONFEED.search(text):
        delta -= 3
    if _META.search(text):
        delta -= 2
    if _POLITE.search(text):
        delta += 3
    # 부정 신호가 없고 성의 있게 쓴(길이) 온토픽 발화엔 소폭 가점 — 평범한 업무 대화가 천천히 쌓이도록
    if delta == 0 and len(text) >= 12:
        delta += 1
    return max(_MIN_DELTA, min(_MAX_DELTA, delta))


def bumped(state: dict, npc_id: str, delta: int) -> tuple[dict, int]:
    """호감도에 delta 적용(0~100 클램프) → (새 state, 새 호감도). state는 얕은 복사."""
    affinity = dict(state.get("affinity") or {})
    new_value = max(MIN, min(MAX, affinity.get(npc_id, BASE) + delta))
    affinity[npc_id] = new_value
    new_state = dict(state)
    new_state["affinity"] = affinity
    return new_state, new_value


def band(value: int) -> str:
    """호감도 → 말투 밴드. 프롬프트가 이 밴드로 온기만 조절한다."""
    if value <= 30:
        return "낮음"
    if value >= 70:
        return "높음"
    return "보통"
