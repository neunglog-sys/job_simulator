"""한국어 조사 — 받침 유무로 이/가, 을/를, 은/는, 과/와, (으)로를 고른다.

NPC 이름을 문장에 끼워 넣을 때 "김세라이(가) 다급하게 찾아왔다"처럼 나가면 몰입이 깨진다.
이름은 콘텐츠·LLM이 만들어 미리 알 수 없으므로 렌더 시점에 골라야 한다.
"""


def _has_batchim(word: str) -> bool | None:
    """마지막 글자에 받침이 있나. 한글이 아니면 None(판단 불가)."""
    for ch in reversed(word.strip()):
        if "가" <= ch <= "힣":
            return (ord(ch) - 0xAC00) % 28 != 0
        if ch.isalnum():
            return None  # 영문·숫자로 끝나면 규칙을 단정하지 않는다
    return None


def particle(word: str, with_batchim: str, without: str) -> str:
    """받침 있으면 with_batchim, 없으면 without. 판단 불가면 without(자연스러운 쪽)."""
    has = _has_batchim(word)
    return with_batchim if has else without


def josa(word: str, kind: str = "이") -> str:
    """이름 뒤에 붙일 조사 한 글자. kind는 받침 있는 형태로 준다('이','을','은','과','으로')."""
    pairs = {"이": "가", "을": "를", "은": "는", "과": "와", "으로": "로"}
    return particle(word, kind, pairs.get(kind, kind))


def with_josa(word: str, kind: str = "이") -> str:
    """'김세라' + '이' → '김세라가' / '김만철' + '이' → '김만철이'."""
    return f"{word}{josa(word, kind)}"
