"""아바타 상담 — Conversation Memory(최근 N턴) + 아바타 프롬프트 + LLM 스트리밍."""

from typing import AsyncIterator

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, Message, User

MEMORY_TURNS = 20  # 컨텍스트에 넣는 최근 메시지 수


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
    system = render_prompt("avatar/system.md", summary=consultation.summary)

    full: list[str] = []
    try:
        async for chunk in get_llm().chat_stream(context, system=system):
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
