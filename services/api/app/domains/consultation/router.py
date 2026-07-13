import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_session
from app.core.deps import get_current_user
from app.domains.consultation import service, survey
from app.domains.consultation.schemas import ConsultationOut, MessageIn, MessageOut, SurveyIn
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


@router.get("/{consultation_id}/survey")
async def get_survey(
    consultation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """사전 설문 문항 배달 (5지선다) — 자유대화 전 단계. 페이징은 프론트 재량."""
    await service.get_owned_consultation(session, consultation_id, user)
    return {"items": survey.public_items()}


@router.post("/{consultation_id}/survey")
async def submit_survey(
    consultation_id: int,
    body: SurveyIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """설문 제출 → 룰 스코어링 → 프로파일 저장 + 자유대화 전환 대사 3종 반환.

    아바타가 프로파일 요약(summary)을 알고 자유대화를 시작한다. 재제출 시 덮어씀.
    """
    consultation = await service.get_owned_consultation(session, consultation_id, user)
    profile = survey.score_answers(body.answers)
    consultation.survey = {"answers": body.answers, "profile": profile}
    flag_modified(consultation, "survey")
    consultation.summary = f"사전 설문 성향: {survey.profile_summary(profile)}"
    await session.commit()
    return {"profile": profile, "avatar_lines": survey.avatar_lines(profile)}


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
