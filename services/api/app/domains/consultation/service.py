"""아바타 상담 — Conversation Memory(최근 N턴) + 아바타 프롬프트 + LLM 스트리밍."""

import asyncio
import logging
import time
from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.counseling import build_safety_notes
from app.content.knowledge import search_knowledge
from app.domains.consultation import resume as resume_mod
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, Message, User

logger = logging.getLogger(__name__)

MEMORY_TURNS = 20  # 컨텍스트에 넣는 최근 메시지 수
RAG_TOP_K = 3
RAG_MAX_DISTANCE = 0.4  # Gemini 임베딩 거리대(관련 ~0.2·무관 ~0.28)에 맞춤 — 잡담에 직무 지식이 끼어들지 않게
# RAG는 스트리밍 시작 전 직렬 구간 — 실측 ~1.2s를 사용자가 빈 화면으로 기다린다.
# 지연 스파이크에 상담이 볼모잡히지 않게 가드하고, 지식 검색이 무의미한 발화는 왕복을 생략한다.
RAG_EMBED_TIMEOUT_S = 2.0  # 초과 시 지식 없이 진행 (짧은 지연 > 지식 주입 이득)
RAG_MIN_QUERY_CHARS = 8    # "네", "고마워요" 같은 짧은 발화 — 직무 지식이 나올 질의가 아님


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


async def create_consultation(session: AsyncSession, user: User) -> Consultation:
    consultation = Consultation(user_id=user.id)
    session.add(consultation)
    await session.commit()
    await session.refresh(consultation)
    return consultation


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
    session: AsyncSession, consultation: Consultation, user_text: str
) -> AsyncIterator[str]:
    """사용자 발화 저장 → 최근 대화 + 아바타 프롬프트로 LLM 스트리밍 → 응답 저장."""
    t0 = time.perf_counter()
    session.add(Message(consultation_id=consultation.id, role="user", content=user_text))
    await session.commit()

    history = await list_messages(session, consultation.id)
    context = [
        ChatMessage(role=m.role, content=m.content) for m in history[-MEMORY_TURNS:]
    ]

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
    )

    full: list[str] = []
    first_token_ms: float | None = None
    try:
        async for chunk in get_llm().chat_stream(
            context,
            system=system,
            temperature=0.4,
            # 상담은 즉답형 대화 — 사고 토큰을 끄면 첫 토큰이 수 초 빨라진다 (6.7s→1.2s 실측).
            # 채점 등 품질 우선 호출은 기본값(None=모델 기본)을 유지한다.
            thinking_budget=0,
        ):
            if first_token_ms is None:
                first_token_ms = (time.perf_counter() - t0) * 1000
            full.append(chunk)
            yield chunk
    finally:
        # 구간별 지연 분해 — 첫 발화 지연 최적화의 근거 데이터 (프리필 vs 출력 판정용)
        reply = "".join(full)
        logger.info(
            "상담 응답 구간: rag %.0fms · 첫토큰 %.0fms · 전체 %.0fms · 응답 %d자 · system %.1fKB · 지식 %s",
            rag_ms,
            first_token_ms if first_token_ms is not None else -1,
            (time.perf_counter() - t0) * 1000,
            len(reply),
            len(system.encode()) / 1024,
            "유" if knowledge else "무",
        )
        # 클라이언트가 중간에 끊어도 생성된 부분까지는 저장
        if full:
            session.add(
                Message(
                    consultation_id=consultation.id,
                    role="assistant",
                    content=reply,
                )
            )
            await session.commit()
