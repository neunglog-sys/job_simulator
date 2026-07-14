"""아바타 상담 — Conversation Memory(최근 N턴) + 아바타 프롬프트 + LLM 스트리밍."""

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

MEMORY_TURNS = 20  # 컨텍스트에 넣는 최근 메시지 수
RAG_TOP_K = 3
RAG_MAX_DISTANCE = 0.4  # Gemini 임베딩 거리대(관련 ~0.2·무관 ~0.28)에 맞춤 — 잡담에 직무 지식이 끼어들지 않게


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
    session.add(Message(consultation_id=consultation.id, role="user", content=user_text))
    await session.commit()

    history = await list_messages(session, consultation.id)
    context = [
        ChatMessage(role=m.role, content=m.content) for m in history[-MEMORY_TURNS:]
    ]

    # RAG: 발화와 관련된 직무 지식이 있으면 아바타 프롬프트에 주입
    chunks = await search_knowledge(
        session, user_text, top_k=RAG_TOP_K, max_distance=RAG_MAX_DISTANCE
    )
    knowledge = (
        "\n\n".join(f"[{c.source}]\n{c.content}" for c in chunks) if chunks else None
    )

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
    try:
        async for chunk in get_llm().chat_stream(
            context,
            system=system,
            temperature=0.4,
        ):
            full.append(chunk)
            yield chunk
    finally:
        # 클라이언트가 중간에 끊어도 생성된 부분까지는 저장
        if full:
            session.add(
                Message(
                    consultation_id=consultation.id,
                    role="assistant",
                    content="".join(full),
                )
            )
            await session.commit()
