import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.db import get_session
from app.core.deps import get_current_user
from app.domains.consultation import service
from app.domains.consultation.schemas import ConsultationOut, MessageIn, MessageOut
from app.models import Consultation, User

router = APIRouter(prefix="/api/consultations", tags=["consultation"])


@router.get("", response_model=list[ConsultationOut])
async def list_consultations(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """내 상담 목록 (최신순) — 메인화면 이어가기 진입점."""
    rows = (
        await session.execute(
            select(Consultation)
            .where(Consultation.user_id == user.id)
            .order_by(Consultation.id.desc())
        )
    ).scalars()
    return list(rows)


@router.post("", response_model=ConsultationOut, status_code=201)
async def create_consultation(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await service.create_consultation(session, user)


@router.get("/{consultation_id}/messages", response_model=list[MessageOut])
async def get_messages(
    consultation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    await service.get_owned_consultation(session, consultation_id, user)
    return await service.list_messages(session, consultation_id)


@router.post("/{consultation_id}/messages")
async def send_message(
    consultation_id: int,
    body: MessageIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """아바타 응답을 SSE로 스트리밍. 이벤트: token(조각) → done."""
    consultation = await service.get_owned_consultation(session, consultation_id, user)

    async def event_stream():
        try:
            async for chunk in service.stream_reply(session, consultation, body.content):
                yield {"event": "token", "data": json.dumps({"text": chunk}, ensure_ascii=False)}
            yield {"event": "done", "data": "{}"}
        except Exception:  # noqa: BLE001 — 스트림 중간 오류는 이벤트로 전달
            yield {"event": "error", "data": json.dumps({"detail": "응답 생성 실패"})}
            raise

    return EventSourceResponse(event_stream())
