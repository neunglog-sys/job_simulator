import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_session
from app.core.deps import get_current_user
from app.domains.consultation import resume, service, survey
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
    consultation = await service.create_consultation(session, user)
    out = ConsultationOut.model_validate(consultation)
    # 인사 클립이 준비돼 있으면 세션 진입 즉시 재생하라고 알려준다 (없으면 기존 흐름)
    return out.model_copy(update={"greeting_clip_url": service.greeting_clip_url()})


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


@router.post("/{consultation_id}/resume")
async def upload_resume(
    consultation_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """이력서/포트폴리오 PDF 업로드 → 분석. 상담사가 이후 대화에서 희망 직무 방향을 확인한다.

    설문 다음, 자유대화 전에 올리는 것을 권장(선택 — 없어도 상담 진행).
    반환의 opening_question을 아바타 첫 말풍선으로 바로 띄우면 자연스럽다.
    """
    consultation = await service.get_owned_consultation(session, consultation_id, user)
    # PDF만 허용 — content-type 또는 확장자 둘 중 하나로 판별(브라우저 따라 type 누락 대비)
    is_pdf = (file.content_type == "application/pdf") or (
        (file.filename or "").lower().endswith(".pdf")
    )
    if not is_pdf:
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있어요.")
    # 대용량 업로드 방어: Content-Length로 선차단 + 상한+1까지만 읽어(초과 감지) 메모리 폭주 방지.
    if file.size is not None and file.size > resume.MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 커요(최대 8MB).")
    data = await file.read(resume.MAX_PDF_BYTES + 1)
    if len(data) > resume.MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 커요(최대 8MB).")
    analysis = await resume.attach_resume(session, consultation, data)
    return analysis


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
