"""아바타 상담 — Conversation Memory(최근 N턴) + 아바타 프롬프트 + LLM 스트리밍."""

import asyncio
import logging
import re
import time
from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.counseling import build_safety_notes
from app.content.knowledge import search_knowledge
from app.content.loader import load_f_detail_jobs, load_f_families
from app.core.db import SessionFactory
from app.domains.consultation import rag_gate
from app.domains.consultation import resume as resume_mod
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import (
    Consultation,
    Evidence,
    Message,
    Recommendation,
    Report,
    Scenario,
    Simulation,
    User,
)

logger = logging.getLogger(__name__)


async def _play_since_last_reply(
    session: AsyncSession, consultation: Consultation, history: list[Message]
) -> dict | None:
    """마지막 상담사 발화 이후에 사용자가 끝낸 체험이 있으면 그 정보를 돌려준다.

    "시나리오를 마치고 1:1 화면으로 돌아왔을 때 마무리 한마디를 해 달라"는 요구 때문에
    필요하다. 매 턴 프롬프트에 넣으면 상담사가 같은 총평을 계속 반복하므로, **아직
    언급하지 못한 체험이 있을 때만** 넣는다(= 마지막 상담사 발화 뒤에 끝난 체험).

    consultation_id로 걸지 않는 이유: 시나리오를 상담 화면 밖(예: /scenario?slug=kts-03)
    에서 시작하면 그 값이 비어 저장된다(실측). 사용자+시각 기준이라야 실제로 잡힌다.
    """
    last_reply_at = next((m.created_at for m in reversed(history) if m.role == "assistant"), None)
    if last_reply_at is None:
        return None  # 첫 인사 전 — 총평할 맥락 자체가 없다

    row = (
        await session.execute(
            select(Simulation, Scenario.title)
            .join(Scenario, Scenario.id == Simulation.scenario_id)
            .where(
                Simulation.user_id == consultation.user_id,
                Simulation.status == "completed",
                Simulation.created_at > last_reply_at,
            )
            .order_by(Simulation.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None

    simulation, title = row
    state = simulation.state if isinstance(simulation.state, dict) else {}
    score = state.get("score") if isinstance(state.get("score"), dict) else {}
    return {
        "title": title,
        "total": score.get("total"),
        "competencies": {
            key: value
            for key, value in (score.get("competencies") or {}).items()
            if isinstance(value, (int, float))
        },
    }

MEMORY_TURNS = 20  # 컨텍스트에 넣는 최근 메시지 수
RAG_TOP_K = 3
RAG_SCOPE_CANDIDATES = 6  # 스코프 판단용으로 넓게 뽑는 후보 수(직무 분포 보고 RAG_TOP_K로 좁힘)
RAG_MAX_DISTANCE = 0.35  # 실측(0722, doc_chunks 25건): 정답매칭 ~0.22~0.33 · 오프토픽 커리어질문/잡담 ~0.37~0.46.
# 0.4는 오프토픽 8개 중 4개가 통과하는 오탐이 있어 그 사이로 낮춤. 단 이 상담 흐름은 job_code
# 스코프 없이 전역검색이라 동일계열 타직무 오염(예 ys-01 질문에 ys-02 지식, dist 0.31)은
# 거리컷만으론 못 막는다 — 별도 조치 필요(추적: RAG 선택적 스킵 작업과 별개 이슈).
# RAG는 스트리밍 시작 전 직렬 구간 — 실측 ~1.2s를 사용자가 빈 화면으로 기다린다.
# 지연 스파이크에 상담이 볼모잡히지 않게 가드하고, 지식 검색이 무의미한 발화는 왕복을 생략한다.
# 초과 시 지식 없이 진행 (짧은 지연 > 지식 주입 이득).
# 2.0 → 1.0 (2026-07-28): 임베딩 지연이 **이봉분포**라 값을 낮춰도 실패가 안 늘어난다.
#   실측(n=40, 단독): p50 365ms · p90 409ms · p95 2,020ms · max 7,898ms.
#   409ms(p90)와 2,020ms 사이가 비어 있어 0.7~2.0s 어느 값을 써도 실패는 같은 3건(7.5%)이고,
#   낮출수록 그 실패 턴에서 버리는 시간만 준다(2.0s → 1.0s면 턴당 1초 절약).
#   타임아웃 턴은 어차피 지식 0건으로 진행하므로 오래 기다릴수록 손해만 커진다
#   (실측: 타임아웃 턴 TTFT 3,185ms vs 정상 1,499ms).
# ⚠️ 원인은 우리 쪽 이벤트 루프 경합이 아니다 — CPU 블로킹을 인위로 걸어도 임베딩은
#   최대 648ms로 멀쩡했고(2초 초과 0/12), 아무 부하 없는 단독 조건에서도 스파이크가 났다.
#   Gemini 임베딩 API 자체의 꼬리 지연이라 우리가 줄일 수 없고, 빨리 포기하는 게 최선이다.
#   1.0s는 p90(409ms)의 2.4배로 여유를 두되 손실 시간을 줄이는 절충값.
RAG_EMBED_TIMEOUT_S = 1.0
# 일반 진로상담 KB(포트폴리오·이력서·면접·공백기 등) 스코프. 직무 코드가 아니라서
# 직무 스코프만 걸면 통째로 배제된다 — 스코프를 좁힐 때 **반드시 함께 포함**한다.
# (실측: 직무 스코프만 걸면 일반 상담 질문 4/4가 '미주입'으로 떨어짐)
GENERAL_KB_SCOPE = "general-career-counseling"

# 응답 길이 정책 — 긴 응답일수록 아바타 발화 생성이 오래 걸려 사용자가 기다리는 지연이 커진다.
# 첫 응답은 더 짧게 "워밍업"하고, 이후에도 평소엔 짧게 유지하되 사용자가 명시적으로 자세한 설명을
# 요청하면 길이 제한을 풀고 대신 음성(TTS)은 생략한다 — 긴 글을 그대로 읽게 하면 지연만 커진다.
GREETING_REPLY_CHAR_LIMIT = 50
DEFAULT_REPLY_CHAR_LIMIT = 200
# 강조 부사(자세히/상세히/구체적으로/길게)만 보면 "자세히 모르겠어요"(불확실성 표현)를
# 상세 설명 요청으로 오탐한다. 그렇다고 부사 뒤에 설명 동사가 바로 붙어야만 매칭하면 이번엔
# "자세히 생각해보고 설명해줘"처럼 사이에 말이 낀 진짜 요청을 놓친다(false negative).
# 그래서 부사 바로 뒤 짧은 구간만 부정 표현("모르"/"몰라"/"못 "/"안 ") 유무로 걸러내고,
# 그 구간을 통과하면 뒤쪽 넉넉한 범위에서 설명 요청 동사를 찾는다.
_DETAIL_ADVERB_RE = re.compile(r"(?:자세|상세|구체적|길게)(?:히|하게|으로)?")
_DETAIL_REQUEST_VERB_RE = re.compile(r"설명|알려|말해|얘기|풀어")
_DETAIL_NEGATION_MARKERS = ("모르", "몰라", "못 ", "안 ")
_DETAIL_NEGATION_WINDOW = 6
_DETAIL_VERB_WINDOW = 20


def _is_detail_request(text: str) -> bool:
    for m in _DETAIL_ADVERB_RE.finditer(text):
        tail = text[m.end() : m.end() + _DETAIL_VERB_WINDOW]
        if any(neg in tail[:_DETAIL_NEGATION_WINDOW] for neg in _DETAIL_NEGATION_MARKERS):
            continue
        if _DETAIL_REQUEST_VERB_RE.search(tail):
            return True
    return False


# 자해·정신건강 위기 신호. 안전 규칙(SF-011)은 이때 진로상담을 중단하고 전문 도움 경로로
# 안내하게 하는데, 그 안내에는 상담전화 번호가 들어간다 — 200자 컷이 걸리면 번호가
# 중간에 잘린다(실측: '1577-0199' → '1577-01', 사용 불가능한 번호가 그대로 전송됨).
# 위기 응답만은 길이 제한을 풀어 안내가 온전히 나가게 한다.
_CRISIS_MARKERS = (
    "죽고 싶", "죽고싶", "자살", "자해", "극단적 선택", "사라지고 싶", "사라지는 게",
    "없어져버리", "없어지고 싶", "살기 싫", "살고 싶지 않", "끝내버리고 싶", "끝내고 싶",
    "의미가 없", "다 끝내",
)


def _is_crisis(text: str) -> bool:
    return any(m in text for m in _CRISIS_MARKERS)
# 프롬프트의 글자수 지시는 소프트 가이드일 뿐이라 넘길 수 있음 — 토큰 상한은 그 경우의 안전망.
# 한글은 토큰당 여러 글자를 담는 경우가 많아, 목표 글자수보다 넉넉히 잡아 문장이 중간에 끊기지
# 않게 한다. 실제 글자수 컷은 스트리밍 중 total_chars 체크(아래)가 담당한다.
REPLY_MAX_TOKENS_HEADROOM = 120
# 글자수 제한 도달 후, 문장이 끝날 때까지 더 받아주는 여유분.
# 제한 즉시 끊으면 "…추천 직무를 확인해보" 처럼 말이 중간에 잘린다. 그렇다고 제한 자체를
# 올리면 군더더기가 늘어(200자 제한의 본래 취지) 곤란하므로, 마침표 하나까지의 꼬리만 허용한다.
# 이 안에 문장이 안 끝나면 그때는 강제로 닫는다(무한정 기다리지 않음).
REPLY_SENTENCE_GRACE_CHARS = 80
# 문장 종료 판정 — 종결 문장부호. 닫는 따옴표·괄호가 뒤따르는 경우(예: 그래요!") 도 종료로 본다.
_SENTENCE_END_RE = re.compile(r"[.!?。！？…][\"'’”\)\]】」』]*\s*$")


def _ends_sentence(text: str) -> bool:
    return bool(_SENTENCE_END_RE.search(text.rstrip()))


async def _recommended_scope(
    session: AsyncSession, consultation_id: int | None
) -> list[str] | None:
    """추천 직무 + 일반 상담 KB로 검색 스코프를 좁힌다 (없으면 None = 전역검색).

    ⚠️ 재측정(2026-07-27, 골든셋 40건·코퍼스 556청크): 이 함수의 원래 근거였던
    "전역 Recall@1 75% → 스코프 100%"는 **현재 코퍼스에서 재현되지 않는다**.
    전역 65.0%(26/40) vs F 스코프 65.0%(26/40)으로 동일하고(McNemar 불일치쌍 0/0),
    전역 top-1이 이미 97.5%(39/40) 확률로 정답 F 안에 들어 있어 스코프가 잘라낼
    상위 오염 자체가 거의 없다. 코퍼스가 25건→556건으로 커지며 상황이 바뀐 것으로 보인다.
    스코프의 실제 이득은 (a) 타 직무군 오염 7.9%→0%, (b) 지식 미주입 10%→2.5%이며,
    직무 단위 오염은 39.2%→35.4%로 3.8%p만 준다 — 오염의 대부분이 같은 F 안의 인접
    직무라 스코프로는 못 잡는다(별도 재순위화가 필요).
    ⚠️ 추천의 job_code는 소문자(j047)로 저장되고 doc_chunks는 대문자(J047)라 정규화가 필수다
       — 안 하면 IN 조건이 하나도 안 맞아 오히려 전부 미주입이 된다.
    """
    if consultation_id is None:
        return None
    try:
        results = (
            await session.execute(
                select(Recommendation.results).where(
                    Recommendation.consultation_id == consultation_id
                )
            )
        ).scalar_one_or_none()
    except Exception:  # 추천 조회 실패는 상담을 막지 않는다 — 전역검색으로 폴백
        logger.warning("추천 스코프 조회 실패 — 전역검색으로 진행", exc_info=True)
        return None
    # F 개편: 추천 job_code가 F 직무군(f01~)이면 doc_chunks엔 대응 청크가 없다(청크는
    # J001~J103/slug 체계). F는 소속 J코드(f_families.members)로 확장하고, 소속 J가 없는
    # 신설 계열은 시나리오 slug 전용 지식으로 보충한다(기존 갭 패턴). 레거시 j코드 추천은
    # 종전대로 대문자 정규화만 한다.
    fam_members: dict[str, list[str]] | None = None
    codes: list[str] = []
    for r in results or []:
        if not isinstance(r, dict) or not r.get("job_code"):
            continue
        code = str(r["job_code"])
        if code.startswith("f") and code[1:].isdigit():
            if fam_members is None:
                fam_members = {f["code"]: f.get("members") or [] for f in load_f_families()}
            codes.extend(m.upper() for m in fam_members.get(code, []))
            if r.get("scenario_slug"):
                codes.append(str(r["scenario_slug"]))
        else:
            codes.append(code.upper())
    if not codes:
        return None  # 추천 전(대화 초반)에는 전역검색 유지
    return [*codes, GENERAL_KB_SCOPE]


async def _fetch_knowledge(
    session: AsyncSession, user_text: str, scope: list[str] | None = None
) -> str | None:
    """발화 관련 직무 지식 검색 — 게이트 통과분만, 계열 교차오염은 스코프로 좁힘.

    실패·타임아웃·스킵·범용판정 시 None: 상담은 지식 없이도 기존 품질로 계속되어야 한다.
    """
    if not rag_gate.should_run_rag(user_text):
        return None
    try:
        candidates = await search_knowledge(
            session, user_text, job_code=scope,
            top_k=RAG_SCOPE_CANDIDATES, max_distance=RAG_MAX_DISTANCE,
            embed_timeout=RAG_EMBED_TIMEOUT_S,
        )
        chunks = rag_gate.scope_chunks(candidates, top_k=RAG_TOP_K)
        if scope and not chunks:
            # 추천 밖 직무를 물은 경우 — 스코프 안엔 쓸 근거가 없다(후보가 없거나 흩어짐).
            # 전역으로 한 번 더 찾는다. 상담 프롬프트는 사용자가 물은 직무를 설명하게 돼
            # 있는데 여기서 빈손이 되면 '자료 없음' 분기로 빠져 답변이 막연해진다.
            # 임베딩 1회 추가 비용은 이 경우에만 발생한다.
            candidates = await search_knowledge(
                session, user_text,
                top_k=RAG_SCOPE_CANDIDATES, max_distance=RAG_MAX_DISTANCE,
                embed_timeout=RAG_EMBED_TIMEOUT_S,
            )
            chunks = rag_gate.scope_chunks(candidates, top_k=RAG_TOP_K)
    except asyncio.TimeoutError:
        logger.warning("RAG 임베딩 %.1fs 초과 — 지식 없이 진행", RAG_EMBED_TIMEOUT_S)
        return None
    if candidates and not chunks:
        logger.info("RAG 스코프: 여러 직무 흩어짐 → 주입 생략(범용) (후보 %d)", len(candidates))
    return "\n\n".join(f"[{c.source}]\n{c.content}" for c in chunks) if chunks else None


async def _fetch_knowledge_isolated(
    user_text: str, consultation_id: int | None = None
) -> str | None:
    """RAG를 메인 세션과 분리된 세션에서 실행 — 발화 저장·이력 조회와 동시에 돌리기 위함.

    async 세션은 한 세션에서 쿼리를 동시에 못 돌리니 별도 세션이 필요하다.
    임베딩 왕복(~1.2s)이 첫 토큰 앞 직렬 구간에서 빠지도록 태스크로 띄워 쓴다.
    짧은 발화는 연결 체크아웃 없이 즉시 생략하고, 어떤 실패든 None으로 흘려보낸다.
    """
    if not rag_gate.should_run_rag(user_text):
        return None
    try:
        async with SessionFactory() as rag_session:
            # 스코프 조회도 이 분리 세션에서 — 메인 경로(발화 저장·이력)를 붙잡지 않는다.
            scope = await _recommended_scope(rag_session, consultation_id)
            return await _fetch_knowledge(rag_session, user_text, scope)
    except Exception:
        logger.warning("RAG 조회 실패 — 지식 없이 진행", exc_info=True)
        return None


GREETING_CLIP = "greeting.mp4"  # storage/avatar-clips/ 아래 — 아바타 담당이 배치


def greeting_clip_url() -> str | None:
    """인사말 사전 렌더 클립 URL — 파일이 있을 때만. 없으면 프론트는 기존 흐름(생성) 그대로.

    첫 발화는 사용자 입력과 무관한 고정 인사말이므로 미리 렌더해 두면 생성 지연이
    0초가 된다 (아바타 담당 합의: '사전 렌더 SoulX 통일' 전략의 첫 적용처).
    """
    from pathlib import Path

    from app.core.config import settings

    if (Path(settings.storage_dir) / "avatar-clips" / GREETING_CLIP).is_file():
        return f"/avatar-clips/{GREETING_CLIP}"
    return None


async def create_consultation(session: AsyncSession, user: User) -> Consultation:
    consultation = Consultation(user_id=user.id)
    session.add(consultation)
    await session.commit()
    await session.refresh(consultation)
    return consultation


def _single_line(value: str) -> str:
    return " ".join(value.split())


def _truncate(value: str, limit: int) -> str:
    value = _single_line(value)
    return value if len(value) <= limit else f"{value[:limit].rstrip()}…"


async def list_consultation_summaries(
    session: AsyncSession, user: User
) -> list[dict]:
    """상담방 목록에 필요한 제목·미리보기·최근 활동 시각을 계산한다.

    제목/미리보기에 필요한 건 상담방당 '첫 user 메시지 1건 + 마지막 메시지 1건 + 건수'뿐이다.
    전체 메시지를 로드하면(content는 EncryptedText라 행마다 복호화) 상담·대화가 쌓일수록 목록이
    느려지므로, DB 집계로 필요한 메시지 id만 뽑고 그 2건/상담만 복호화한다.
    """
    consultations = list(
        (
            await session.execute(
                select(Consultation)
                .where(Consultation.user_id == user.id)
                .order_by(Consultation.id.desc())
            )
        ).scalars()
    )
    if not consultations:
        return []

    consultation_ids = [c.id for c in consultations]
    # 상담별 집계 — 건수, 첫 user 메시지 id, 마지막 메시지 id (id 순증가라 정렬 기준으로 안전)
    rows = (
        await session.execute(
            select(
                Message.consultation_id,
                func.count().label("cnt"),
                func.min(case((Message.role == "user", Message.id))).label("first_user_id"),
                func.max(Message.id).label("last_id"),
                func.max(Message.created_at).label("updated_at"),
            )
            .where(Message.consultation_id.in_(consultation_ids))
            .group_by(Message.consultation_id)
        )
    ).all()
    agg = {r.consultation_id: r for r in rows}

    # 실제로 내용을 꺼낼 메시지 id만 모아 한 번에 조회 (상담당 최대 2건 → 복호화 최소화)
    wanted_ids = {
        mid
        for r in rows
        for mid in (r.first_user_id, r.last_id)
        if mid is not None
    }
    contents: dict[int, str] = {}
    if wanted_ids:
        picked = (
            await session.execute(select(Message).where(Message.id.in_(wanted_ids)))
        ).scalars()
        contents = {m.id: m.content for m in picked}

    items: list[dict] = []
    for consultation in consultations:
        r = agg.get(consultation.id)
        first_user = contents.get(r.first_user_id) if r else None
        latest = contents.get(r.last_id) if r else None
        items.append(
            {
                "id": consultation.id,
                "status": consultation.status,
                "title": (
                    consultation.title
                    or (_truncate(first_user, 34) if first_user else "새로운 상담")
                ),
                "preview": _truncate(latest, 72) if latest else "아직 나눈 대화가 없어요.",
                "message_count": r.cnt if r else 0,
                "created_at": consultation.created_at,
                "updated_at": r.updated_at if r else consultation.created_at,
            }
        )

    return sorted(items, key=lambda item: item["updated_at"], reverse=True)


async def update_consultation_title(
    session: AsyncSession,
    consultation: Consultation,
    title: str,
) -> Consultation:
    consultation.title = title
    await session.commit()
    await session.refresh(consultation)
    return consultation


async def delete_consultation(
    session: AsyncSession,
    consultation: Consultation,
) -> None:
    """상담과 전용 데이터를 삭제하고, 생성된 리포트·체험은 상담 연결만 해제한다."""
    await session.execute(
        update(Report)
        .where(Report.consultation_id == consultation.id)
        .values(consultation_id=None)
    )
    # 체험(시뮬레이션)도 연결만 끊는다 — 사용자가 실제로 플레이한 기록이라 지우면 안 되고,
    # simulations.consultation_id는 nullable이다("상담 없이 들어온 체험은 NULL").
    # 이 해제가 없으면 fk_simulations_consultation_id 위반으로 삭제가 500이 된다
    # (consultation_id 컬럼이 나중에 추가되며 이 함수가 갱신되지 않았던 것 — 실서버 재현).
    await session.execute(
        update(Simulation)
        .where(Simulation.consultation_id == consultation.id)
        .values(consultation_id=None)
    )
    await session.execute(
        delete(Recommendation).where(Recommendation.consultation_id == consultation.id)
    )
    # evidence.consultation_id는 non-nullable(상담 전용 판단근거)이라 해제 대신 삭제한다.
    # 현재는 writer가 없어 행이 쌓이지 않지만, 연결되는 순간 같은 FK 위반이 재발한다.
    await session.execute(delete(Evidence).where(Evidence.consultation_id == consultation.id))
    await session.execute(delete(Message).where(Message.consultation_id == consultation.id))
    await session.delete(consultation)
    await session.commit()


async def get_owned_consultation(
    session: AsyncSession, consultation_id: int, user: User
) -> Consultation:
    consultation = await session.get(Consultation, consultation_id)
    if consultation is None or consultation.user_id != user.id:
        raise HTTPException(status_code=404, detail="상담 세션을 찾을 수 없음")
    return consultation


async def list_messages(session: AsyncSession, consultation_id: int) -> list[Message]:
    return list(
        (
            await session.execute(
                select(Message)
                .where(Message.consultation_id == consultation_id)
                .order_by(Message.id)
            )
        ).scalars()
    )


async def stream_reply(
    session: AsyncSession, consultation: Consultation, user_text: str,
    *, meta: dict | None = None,
) -> AsyncIterator[str]:
    """사용자 발화 저장 → 최근 대화 + 아바타 프롬프트로 LLM 스트리밍 → 응답 저장.

    meta: 넘기면 호출부(라우터)가 SSE done 이벤트 등에 실어 보낼 부가 정보(skip_tts 등)를
    이 dict에 채워 넣는다. 스트림 자체(yield하는 텍스트)의 계약은 바꾸지 않는다.
    """
    t0 = time.perf_counter()
    # RAG(임베딩+검색 ~1.2s)를 별도 세션 태스크로 먼저 띄운다 — 발화 저장·이력 조회와
    # 병렬로 진행돼, 첫 토큰 앞 직렬 구간에서 준비 작업 시간만큼 겹쳐 사라진다.
    try:
        rag_run, rag_reason = rag_gate.rag_decision(user_text)
    except Exception:  # 게이트 판정 실패해도 상담 턴은 안 죽고 RAG 진행(fail-open, 기존 계약 유지)
        logger.warning("RAG 게이트 판정 실패 — 지식 검색 진행", exc_info=True)
        rag_run, rag_reason = True, "run"
    knowledge_task = (
        asyncio.create_task(_fetch_knowledge_isolated(user_text, consultation.id))
        if rag_run
        else None
    )
    try:
        session.add(Message(consultation_id=consultation.id, role="user", content=user_text))
        await session.commit()

        history = await list_messages(session, consultation.id)
        context = [
            ChatMessage(role=m.role, content=m.content) for m in history[-MEMORY_TURNS:]
        ]

        # 시나리오를 마치고 돌아온 직후면 마무리 총평을 하도록 프롬프트에 실어 준다.
        recent_play = await _play_since_last_reply(session, consultation, history)

        # 추천이 이미 있으면 F 직무군·세부직업을 상담사에게 알려준다 — "이 분야에 어떤
        # 직업이 있어요?" 질문에 조사 자료로 답하게(지어내기 방지). 부가 기능이라 조회
        # 실패는 상담을 막지 않는다.
        recommended_families = None
        try:
            rec_results = (
                await session.execute(
                    select(Recommendation.results).where(
                        Recommendation.consultation_id == consultation.id
                    )
                )
            ).scalar_one_or_none()
            if rec_results:
                detail_map = load_f_detail_jobs()
                recommended_families = [
                    {
                        "title": r.get("job_title"),
                        "detail_jobs": detail_map.get(str(r.get("job_code")), {}).get(
                            "primary", []
                        ),
                    }
                    for r in rec_results
                    if isinstance(r, dict) and r.get("job_title")
                ]
        except Exception:  # noqa: BLE001
            logger.warning("추천 직무군 컨텍스트 조회 실패 — 상담은 계속", exc_info=True)

        # 응답 길이 산정 — 첫 응답은 워밍업으로 더 짧게, 상세 설명 요청은 제한 해제 + TTS 생략
        is_first_reply = not any(m.role == "assistant" for m in history)
        detail_requested = _is_detail_request(user_text)
        crisis = _is_crisis(user_text)
        if crisis or detail_requested:
            # 위기 응답은 상담전화 안내가 잘리면 안 된다(번호 절단 실측) — 첫 응답이어도 제한 해제.
            char_limit = None
        elif is_first_reply:
            char_limit = GREETING_REPLY_CHAR_LIMIT
        else:
            char_limit = DEFAULT_REPLY_CHAR_LIMIT
        max_tokens = None if char_limit is None else char_limit + REPLY_MAX_TOKENS_HEADROOM
        if meta is not None:
            meta["skip_tts"] = detail_requested

        # RAG 합류 — 위에서 먼저 띄워 이미 진행 중이라, 준비 작업과 못 겹친 잔여분만 대기.
        # rag_ms는 이제 "RAG가 첫 토큰을 실제로 지연시킨 순수 시간"을 뜻한다(겹친 만큼 줄어듦).
        rag_start = time.perf_counter()
        knowledge = await knowledge_task if knowledge_task is not None else None
        rag_ms = (time.perf_counter() - rag_start) * 1000
    finally:
        # 조인 전(commit·list_messages 등)에서 예외가 나면 여기까지 못 와 태스크가 고아로 남아
        # 별도 세션 커넥션을 ~2초(임베딩 타임아웃)간 붙잡는다 — 정상 조인이면 done()이라 no-op,
        # 아니면 취소해 커넥션을 즉시 회수한다.
        if knowledge_task is not None and not knowledge_task.done():
            knowledge_task.cancel()

    try:
        safety_notes = build_safety_notes()
    except Exception:
        # 데이터팩 로딩 실패 시에도 상담 자체는 기존 동작 그대로 계속되어야 함
        safety_notes = None

    system = render_prompt(
        "avatar/system.md",
        summary=consultation.summary,
        resume=resume_mod.load_analysis(consultation),  # 이력 분석 있으면 상담사가 방향 확인에 활용
        knowledge=knowledge,
        safety_notes=safety_notes,
        reply_char_limit=char_limit,
        # 사전 설문 전이면 추천이 아니라 설문으로 안내해야 한다(추천 품질이 설문에 달려 있다).
        survey_done=bool(consultation.survey),
        recent_play=recent_play,
        recommended_families=recommended_families,
    )

    full: list[str] = []
    first_token_ms: float | None = None
    total_chars = 0
    reply_stream = get_llm().chat_stream(
        context,
        system=system,
        temperature=0.4,
        # 상담은 즉답형 대화 — 사고 토큰을 끄면 첫 토큰이 수 초 빨라진다 (6.7s→1.2s 실측).
        # 채점 등 품질 우선 호출은 기본값(None=모델 기본)을 유지한다.
        thinking_budget=0,
        max_tokens=max_tokens,
    )
    try:
        async for chunk in reply_stream:
            if first_token_ms is None:
                first_token_ms = (time.perf_counter() - t0) * 1000
            full.append(chunk)
            total_chars += len(chunk)
            yield chunk
            if char_limit is None:
                continue
            # 목표 글자수 도달 후 **문장이 끝나는 지점**까지만 더 받고 닫는다.
            # 예전엔 도달 즉시 aclose 해서 "…추천 직무를 확인해보" 처럼 말이 중간에 잘렸다.
            # 제한을 올리면 군더더기가 늘어나므로(200자 제한의 본래 취지) 한도는 그대로 두고,
            # 마침표까지의 여유분(grace)만 허용한다 — 그 안에 안 끝나면 강제로 닫는다.
            if total_chars >= char_limit + REPLY_SENTENCE_GRACE_CHARS or (
                total_chars >= char_limit and _ends_sentence("".join(full))
            ):
                await reply_stream.aclose()
                break
    finally:
        # 구간별 지연 분해 — 첫 발화 지연 최적화의 근거 데이터 (프리필 vs 출력 판정용)
        reply = "".join(full)
        logger.info(
            "상담 응답 구간: rag %.0fms(%s) · 첫토큰 %.0fms · 전체 %.0fms · 응답 %d자(제한 %s) · system %.1fKB · 지식 %s",
            rag_ms,
            rag_reason,
            first_token_ms if first_token_ms is not None else -1,
            (time.perf_counter() - t0) * 1000,
            len(reply),
            char_limit if char_limit is not None else "없음",
            len(system.encode()) / 1024,
            "유" if knowledge else "무",
        )
        # 클라이언트가 중간에 끊어도 생성된 부분까지는 저장.
        # SSE 취소(탭 닫기) 중에는 이 finally가 취소된 태스크 안이라, shield 없이 await commit하면
        # 즉시 CancelledError로 저장이 유실된다 — shield로 감싸 부분 응답을 확실히 남긴다.
        if full:
            session.add(
                Message(
                    consultation_id=consultation.id,
                    role="assistant",
                    content=reply,
                )
            )
            await asyncio.shield(session.commit())
