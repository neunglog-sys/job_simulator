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
from app.domains.consultation import resume as resume_mod
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, Message, Recommendation, Report, User

logger = logging.getLogger(__name__)

MEMORY_TURNS = 20  # 컨텍스트에 넣는 최근 메시지 수
RAG_TOP_K = 3
RAG_MAX_DISTANCE = 0.4  # Gemini 임베딩 거리대(관련 ~0.2·무관 ~0.28)에 맞춤 — 잡담에 직무 지식이 끼어들지 않게
# RAG는 스트리밍 시작 전 직렬 구간 — 실측 ~1.2s를 사용자가 빈 화면으로 기다린다.
# 지연 스파이크에 상담이 볼모잡히지 않게 가드하고, 지식 검색이 무의미한 발화는 왕복을 생략한다.
RAG_EMBED_TIMEOUT_S = 2.0  # 초과 시 지식 없이 진행 (짧은 지연 > 지식 주입 이득)
RAG_MIN_QUERY_CHARS = 8    # "네", "고마워요" 같은 짧은 발화 — 직무 지식이 나올 질의가 아님

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
# 프롬프트의 글자수 지시는 소프트 가이드일 뿐이라 넘길 수 있음 — 토큰 상한은 그 경우의 안전망.
# 한글은 토큰당 여러 글자를 담는 경우가 많아, 목표 글자수보다 넉넉히 잡아 문장이 중간에 끊기지
# 않게 한다. 실제 글자수 컷은 스트리밍 중 total_chars 체크(아래)가 담당한다.
REPLY_MAX_TOKENS_HEADROOM = 120


async def _fetch_knowledge(session: AsyncSession, user_text: str) -> str | None:
    """발화 관련 직무 지식 검색 — 짧은 발화는 생략, 임베딩 지연 스파이크는 타임아웃.

    실패·타임아웃 시 None: 상담은 지식 없이도 기존 품질로 계속되어야 한다.
    """
    if len(user_text.strip()) < RAG_MIN_QUERY_CHARS:
        return None
    try:
        chunks = await search_knowledge(
            session, user_text, top_k=RAG_TOP_K, max_distance=RAG_MAX_DISTANCE,
            embed_timeout=RAG_EMBED_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.warning("RAG 임베딩 %.1fs 초과 — 지식 없이 진행", RAG_EMBED_TIMEOUT_S)
        return None
    return "\n\n".join(f"[{c.source}]\n{c.content}" for c in chunks) if chunks else None


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
    """상담과 전용 데이터를 삭제하고, 생성된 리포트는 상담 연결만 해제한다."""
    await session.execute(
        update(Report)
        .where(Report.consultation_id == consultation.id)
        .values(consultation_id=None)
    )
    await session.execute(
        delete(Recommendation).where(Recommendation.consultation_id == consultation.id)
    )
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
    session.add(Message(consultation_id=consultation.id, role="user", content=user_text))
    await session.commit()

    history = await list_messages(session, consultation.id)
    context = [
        ChatMessage(role=m.role, content=m.content) for m in history[-MEMORY_TURNS:]
    ]

    # 응답 길이 산정 — 첫 응답은 워밍업으로 더 짧게, 상세 설명 요청은 제한 해제 + TTS 생략
    is_first_reply = not any(m.role == "assistant" for m in history)
    detail_requested = _is_detail_request(user_text)
    if detail_requested:
        char_limit = None
    elif is_first_reply:
        char_limit = GREETING_REPLY_CHAR_LIMIT
    else:
        char_limit = DEFAULT_REPLY_CHAR_LIMIT
    max_tokens = None if char_limit is None else char_limit + REPLY_MAX_TOKENS_HEADROOM
    if meta is not None:
        meta["skip_tts"] = detail_requested

    # RAG: 발화와 관련된 직무 지식이 있으면 아바타 프롬프트에 주입
    rag_start = time.perf_counter()
    knowledge = await _fetch_knowledge(session, user_text)
    rag_ms = (time.perf_counter() - rag_start) * 1000

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
            if char_limit is not None and total_chars >= char_limit:
                # 목표 글자수 도달 — 나머지 생성은 기다리지 않고 스트림을 바로 닫는다
                # (지연 절감 본래 목적과 직결되는 부분).
                await reply_stream.aclose()
                break
    finally:
        # 구간별 지연 분해 — 첫 발화 지연 최적화의 근거 데이터 (프리필 vs 출력 판정용)
        reply = "".join(full)
        logger.info(
            "상담 응답 구간: rag %.0fms · 첫토큰 %.0fms · 전체 %.0fms · 응답 %d자(제한 %s) · system %.1fKB · 지식 %s",
            rag_ms,
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
