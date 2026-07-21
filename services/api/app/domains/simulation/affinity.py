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
# 정답을 대신 달라는 요구 (스푼피딩 — NPC가 싫어함, 하락).
# 오탐 방지: '대답'(reply)은 (?<!대)로 제외하고, 답/대신은 '알려·줘·달라' 같은 요청 동사가
# 붙을 때만 잡는다 → "대답을 준비했습니다", "제가 대신 작성해 드렸어요"(협조) 같은 정상 문장 제외.
_SPOONFEED = re.compile(
    r"정답"
    r"|(?<!대)답\s*(을|이|좀|만)?\s*(알려|줘|주세요|내놔|찍|가르쳐|뭐)"
    r"|그냥\s*(좀\s*)?(알려|해\s*줘)"
    r"|(너|네|니|당신)\s*가?\s*대신"  # 2인칭 주어 + 대신 (= 네가 해줘)
    r"|대신[\s\S]{0,5}(줘|주세요|달라|달란|달래)"  # 대신 ~해 줘/달라 (요청형만)
    r"|모범\s*답안|풀어\s*줘|찍어\s*줘|가르쳐\s*줘"
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

# 첫 대면 인사말 — 용건과 섞여 있어도(예: "안녕하세요, 이거 어떻게…") 인사로 인정한다.
_GREETING = re.compile(
    r"안녕|반갑|반가워|처음\s*뵙|뵙겠|뵙습|잘\s*부탁|좋은\s*(아침|오후|저녁)"
    r"|하이|헬로|hello|안뇽|방가|인사\s*드",
    re.IGNORECASE,
)
_GREETING_EN = re.compile(r"\bhi\b", re.IGNORECASE)  # 영어 hi 단독(단어경계) — history 등 오탐 방지

# 첫 대면인데 인사 없이 용건부터 꺼낼 때의 예절 페널티(호감도 감소). 무례(-6)보단 약하게.
FIRST_MEETING_NO_GREETING_PENALTY = -5


def is_greeting(user_text: str) -> bool:
    """발화에 첫 대면 인사말이 들어 있는가(용건과 섞여 있어도 인사로 인정)."""
    text = (user_text or "").strip()
    if not text:
        return False
    return bool(_GREETING.search(text) or _GREETING_EN.search(text))


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
