from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import get_current_user
from app.domains.reporting import service
from app.domains.reporting.schemas import ReportCreate, ReportOut
from app.models import User

router = APIRouter(prefix="/api/reports", tags=["reporting"])


@router.post("", response_model=ReportOut, status_code=202)
async def create_report(
    body: ReportCreate,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """리포트 생성 시작 (비동기) — status가 done이 될 때까지 GET으로 폴링."""
    report = await service.create_report(session, user, body.consultation_id)
    background.add_task(service.generate_report, report.id)
    return report


@router.get("/{report_id}", response_model=ReportOut)
async def get_report(
    report_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await service.get_owned_report(session, report_id, user)


@router.get("/{report_id}/pdf")
async def download_pdf(
    report_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    report = await service.get_owned_report(session, report_id, user)
    if report.status != "done" or not report.pdf_path:
        raise HTTPException(status_code=409, detail=f"리포트가 준비되지 않음 (status={report.status})")
    return FileResponse(
        report.pdf_path,
        media_type="application/pdf",
        filename=f"진로리포트_{report_id}.pdf",
    )
