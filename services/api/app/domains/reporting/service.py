"""리포트 생성 — 상담·추천 종합 → 직무 마스터 분석(LLM) → PDF (설계서 §6-③).

생성은 BackgroundTasks로 비동기 처리, 프론트는 status 폴링 후 PDF 다운로드.
"""

import logging
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_competencies
from app.core.config import settings
from app.core.db import SessionFactory
from app.domains.consultation.service import get_owned_consultation, list_messages
from app.domains.reporting.pdf import render_report_pdf
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Recommendation, Report, User

logger = logging.getLogger(__name__)

_REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "fit_score": {"type": "integer"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "advice": {"type": "string"},
    },
    "required": ["fit_score", "strengths", "improvements", "advice"],
    "additionalProperties": False,
}


async def create_report(
    session: AsyncSession, user: User, consultation_id: int
) -> Report:
    await get_owned_consultation(session, consultation_id, user)
    recommendation = (
        await session.execute(
            select(Recommendation)
            .where(Recommendation.consultation_id == consultation_id)
            .order_by(Recommendation.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if recommendation is None:
        raise HTTPException(
            status_code=400, detail="추천 결과가 없음 — 먼저 직무 추천을 실행하세요"
        )

    report = Report(user_id=user.id, consultation_id=consultation_id)
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return report


async def generate_report(report_id: int) -> None:
    """백그라운드 실행 — 자체 세션 사용."""
    async with SessionFactory() as session:
        report = await session.get(Report, report_id)
        try:
            user = await session.get(User, report.user_id)
            messages = await list_messages(session, report.consultation_id)
            recommendation = (
                await session.execute(
                    select(Recommendation)
                    .where(Recommendation.consultation_id == report.consultation_id)
                    .order_by(Recommendation.id.desc())
                    .limit(1)
                )
            ).scalar_one()

            transcript = "\n".join(
                f"{'사용자' if m.role == 'user' else '상담사'}: {m.content}"
                for m in messages
            )
            system = render_prompt(
                "job-master/consult-report.md",
                recommendations=recommendation.results,
                competencies=load_competencies(),
            )
            analysis = await get_llm().chat_json(
                [ChatMessage(role="user", content=f"## 상담 대화\n{transcript}")],
                system=system,
                json_schema=_REPORT_SCHEMA,
            )

            pdf_dir = Path(settings.storage_dir) / "reports"
            pdf_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = pdf_dir / f"report_{report.id}.pdf"
            render_report_pdf(
                pdf_path,
                user_name=user.name,
                recommendations=recommendation.results,
                fit_score=analysis["fit_score"],
                strengths=analysis["strengths"],
                improvements=analysis["improvements"],
                advice=analysis["advice"],
            )

            report.fit_score = max(0, min(100, int(analysis["fit_score"])))
            report.strengths = analysis["strengths"]
            report.improvements = analysis["improvements"]
            report.advice = analysis["advice"]
            report.pdf_path = str(pdf_path)
            report.status = "done"
        except Exception:  # noqa: BLE001
            logger.exception("리포트 생성 실패 (id=%d)", report_id)
            report.status = "failed"
        await session.commit()


async def get_owned_report(
    session: AsyncSession, report_id: int, user: User
) -> Report:
    report = await session.get(Report, report_id)
    if report is None or report.user_id != user.id:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없음")
    return report
