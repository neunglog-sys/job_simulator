"""상담 RAG 게이트 — 어떤 발화에 직무지식 검색(임베딩+벡터서치)을 돌릴지 결정.

전부 순수 함수. 결정 순서: 질문 → 키워드 → 짧으면 스킵 → 순수잡담 스킵 → 기본 실행.
기본값이 '실행'이라 애매하면 RAG를 도는 쪽(품질 안전)으로 기운다.
스킵은 지식검색만 생략할 뿐 응답 생성은 항상 진행된다.
"""

import re
from functools import lru_cache

from app.core.config import settings

RAG_MIN_QUERY_CHARS = 8  # 이보다 짧고 질문/키워드도 아니면 스킵 ("네","고마워요")

# ── 질문 판정 ──────────────────────────────────────────────
# 의문사(부분 포함) — "뭐야"는 물음표 없이도 잡힘.
_QUESTION_WORDS = re.compile(r"뭐|무엇|무슨|어떻|어떤|어찌|왜|언제|어디|누구|얼마|몇|어때")
# 의문 어미(조합형 음절 접미). 문말 구두점 제거 후 끝을 검사.
_QUESTION_ENDINGS = re.compile(r"(까요|까|나요|은가요|인가요|는지|은지|인지|을지|을까요)$")


def _is_question(s: str) -> bool:
    stripped = s.strip()
    core = stripped.rstrip("?？!！.…~· ").strip()
    if _QUESTION_WORDS.search(core):
        return True
    if _QUESTION_ENDINGS.search(core):
        return True
    # 물음표로 끝나면 질문 — 단 "네?"·"ㅋㅋ?" 같은 순수 리액션(filler/웃음)은 제외.
    # (_FILLER_TOKENS/_LAUGH는 아래 정의 — 호출 시점엔 모듈 로드 완료라 안전)
    return (
        stripped.endswith(("?", "？"))
        and bool(core)
        and core not in _FILLER_TOKENS
        and not _LAUGH.match(core)
    )


# ── 커리어 키워드(고정 셋) ─────────────────────────────────
# 직무 title에는 없지만 지원자가 실제 치는 단어. 부분 매칭(포트폴리오를 → 매칭).
# _job_keywords()가 직무명 토큰을 여기에 합친다.
_CAREER_TERMS = frozenset({
    "포트폴리오", "자기소개서", "자소서", "이력서", "면접", "연봉", "협상",
    "이직", "취업", "채용", "인턴", "신입", "경력", "스펙", "자격증",
    "코딩테스트", "커리어", "진로", "직무", "실무", "인턴십",
})

# 직무명 토큰에서 걸러낼 범용 행정어(있으면 과트리거 → 스킵이 덜 됨).
_TITLE_STOPWORDS = frozenset({
    "보조", "담당", "담당자", "관리", "운영", "사무", "사무원", "사무직",
    "신입", "팀", "업무", "지원", "및", "등", "재", "직", "원",
})
_TITLE_SPLIT = re.compile(r"[\s·()/,]+")


def _extract_keywords_from_titles(titles: list[str]) -> frozenset[str]:
    out: set[str] = set()
    for title in titles:
        for tok in _TITLE_SPLIT.split(title):
            tok = tok.strip()
            if len(tok) >= 2 and tok not in _TITLE_STOPWORDS:
                out.add(tok)
    return frozenset(out)


@lru_cache(maxsize=1)
def _job_keywords() -> frozenset[str]:
    # 직무 카탈로그(data/jobs/*.yaml)의 title에서 1회 도출. 직무 추가 시 자동 반영.
    from app.content.loader import load_jobs

    try:
        titles = [j["title"] for j in load_jobs() if j.get("title")]
    except Exception:
        return frozenset()  # 카탈로그 로드 실패해도 게이트는 커리어 용어로 동작
    return _extract_keywords_from_titles(titles)


def _has_job_keyword(s: str) -> bool:
    return any(term in s for term in _CAREER_TERMS) or any(
        term in s for term in _job_keywords()
    )


# ── 순수 잡담 판정 ─────────────────────────────────────────
# "메시지 전체가 filler일 때만" 잡담. 부분 매칭 아님(정확 토큰 매칭)이라
# "면접 감사합니다"처럼 실질어가 있으면 잡담으로 안 본다(안전).
_FILLER_TOKENS = frozenset({
    "네", "넵", "넹", "예", "응", "웅", "ㅇㅇ",
    "알겠어", "알겠어요", "알겠습니다", "알았어", "알았어요",
    "고마워", "고마워요", "고맙습니다", "감사", "감사해", "감사해요", "감사합니다", "감사드려요",
    "좋아", "좋아요", "좋네요", "좋습니다", "그렇군요", "그렇구나", "그러네요",
    "맞아", "맞아요", "맞습니다", "오케이", "오키", "ok", "그래", "그래요",
    "아하", "우와", "와우", "대박", "화이팅", "파이팅", "힘내", "힘내요",
    "안녕", "안녕하세요", "하이", "반가워", "반가워요", "반갑습니다", "헬로",
})
_PUNCT_STRIP = " \t.,!?~…·\"'()[]"
_LAUGH = re.compile(r"^[ㅋㅎㅠㅜ]+$")


def _is_chitchat(s: str) -> bool:
    tokens = [t.strip(_PUNCT_STRIP).lower() for t in s.split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return True
    return all(t in _FILLER_TOKENS or _LAUGH.match(t) for t in tokens)


# ── 결정 ───────────────────────────────────────────────────
def rag_decision(text: str) -> tuple[bool, str]:
    s = text.strip()
    if not settings.rag_selective_skip:
        run = len(s) >= RAG_MIN_QUERY_CHARS
        return run, ("run" if run else "short")
    if _is_question(s):
        return True, "run"
    if _has_job_keyword(s):
        return True, "run"
    if len(s) < RAG_MIN_QUERY_CHARS:
        return False, "short"
    if _is_chitchat(s):
        return False, "chitchat"
    return True, "run"


def should_run_rag(text: str) -> bool:
    return rag_decision(text)[0]


# ── 스코프(하이브리드) ─────────────────────────────────────
# 상담(1:1 코치) RAG는 job_code 스코프 없이 전역검색이라, 직무특정 어휘가 없는 범용질문은
# 같은 계열 여러 직무가 섞여 나온다(거리컷으론 못 막음). 검색 결과의 직무 분포로 판단:
#   - 최상위(가장 가까운) 직무가 지배적(단일 직무거나 2청크 이상) → 그 직무로 좁힘(일관 답변)
#   - 여러 직무에 1청크씩 흩어짐(지배 없음) → 빈 결과 = 주입 생략(범용 답변, 억지 직무 선택 안 함)
# chunks는 거리 오름차순(가장 가까운 게 [0]). DocChunk import 없이 .job_code만 덕타이핑으로 씀.
# ⚠️ 한계(v1, count 기반): 거리 margin을 안 본다 → 근소차 최근접을 '지배'로 볼 수 있고,
#   강한 단일청크 매칭이 청크 수 1이라는 이유로 범용처리될 수 있다. 거리 기반 정밀화는
#   search_knowledge가 distance를 반환해야 해서(호출부 3곳 영향) 후속 과제로 남김.
def scope_chunks(chunks: list, top_k: int) -> list:
    if not chunks:
        return []
    top_job = chunks[0].job_code
    same = [c for c in chunks if c.job_code == top_job]
    if len({c.job_code for c in chunks}) == 1 or len(same) >= 2:
        return same[:top_k]
    return []
