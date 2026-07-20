"""리포트 생성 — 상담·추천 종합 → 직무 마스터 분석(LLM) → PDF (설계서 §6-③).

생성은 BackgroundTasks로 비동기 처리, 프론트는 status 폴링 후 PDF 다운로드.
"""

import logging
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_competencies
from app.core.config import settings
from app.core.db import SessionFactory
import asyncio

from app.domains.consultation.service import list_messages
from app.domains.reporting.pdf import render_report_pdf
from app.domains.recommendation.service import get_latest_recommendation
from app.domains.scoring import aggregate
from app.domains.simulation.service import get_owned_simulation
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Report, Scenario, Simulation, User

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
    session: AsyncSession,
    user: User,
    consultation_id: int,
    simulation_id: int | None = None,
) -> Report:
    # 추천의 유일한 기준은 저장된 recommendations.results — 리포트가 추천을 다시 만들지 않는다
    # (팀 결정 2026-07-20). 조회는 recommendation 도메인의 단일 헬퍼로 통일해, 세 곳에서 각자
    # 인라인 select 하다 '최신 추천' 판별 기준이 갈라지는 것을 막는다. (소유권 체크도 헬퍼가 함)
    recommendation = await get_latest_recommendation(session, user, consultation_id)
    if recommendation is None:
        raise HTTPException(
            status_code=400, detail="추천 결과가 없음 — 먼저 직무 추천을 실행하세요"
        )

    if simulation_id is not None:
        simulation, _ = await get_owned_simulation(session, simulation_id, user)
        if simulation.status != "completed":
            raise HTTPException(
                status_code=400, detail="완주한 시뮬레이션만 리포트에 반영할 수 있음"
            )

    report = Report(
        user_id=user.id, consultation_id=consultation_id, simulation_id=simulation_id
    )
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
            # create_report와 같은 헬퍼로 조회 — 생성~실행 사이 추천이 지워졌으면 None이므로
            # scalar_one()의 NoResultFound(→failed로 조용히 묻힘) 대신 명시적으로 처리한다.
            recommendation = await get_latest_recommendation(
                session, user, report.consultation_id
            )
            if recommendation is None:
                raise HTTPException(status_code=400, detail="추천 결과가 사라짐 — 리포트 생성 불가")

            # 수행 데이터 (시뮬레이션 연결 시) — 확정 공식: 최종 = 상담 50% + 수행 50%
            performance = None
            percentile = None
            if report.simulation_id is not None:
                simulation = await session.get(Simulation, report.simulation_id)
                scenario = await session.get(Scenario, simulation.scenario_id)
                score = await aggregate.simulation_score(session, simulation, scenario)
                percentile = await aggregate.scenario_percentile(
                    session, scenario.id,
                    (simulation.state.get("score") or {}).get("total", score["total"]),
                    exclude_simulation_id=simulation.id,
                )
                performance = {**score, "scenario_title": scenario.title}
                # 체험자가 직접 쓴 소감 — 채점 대상이 아니라 리포트의 세 번째 재료
                # (리포트 = 상담 + 수행 + 소감). 본인의 말이므로 그대로 넘긴다.
                performance["reflection"] = simulation.state.get("reflection")

            transcript = "\n".join(
                f"{'사용자' if m.role == 'user' else '상담사'}: {m.content}"
                for m in messages
            )
            system = render_prompt(
                "job-master/consult-report.md",
                recommendations=recommendation.results,
                competencies=load_competencies(),
                performance=performance,
            )
            analysis = await get_llm().chat_json(
                [ChatMessage(role="user", content=f"## 상담 대화\n{transcript}")],
                system=system,
                json_schema=_REPORT_SCHEMA,
            )

            consult_fit = max(0, min(100, int(analysis["fit_score"])))
            if performance is not None:
                final_fit = round(consult_fit * 0.5 + performance["total"] * 0.5)
            else:
                final_fit = consult_fit

            pdf_dir = Path(settings.storage_dir) / "reports"
            pdf_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = pdf_dir / f"report_{report.id}.pdf"
            # PDF 렌더는 동기 CPU/파일IO — 이벤트루프에서 직접 돌리면 렌더 동안 모든 WS·SSE
            # 스트림과 API가 멈춘다. 스레드로 오프로드해 루프를 비운다.
            await asyncio.to_thread(
                render_report_pdf,
                pdf_path,
                user_name=user.name,
                recommendations=recommendation.results,
                fit_score=final_fit,
                strengths=analysis["strengths"],
                improvements=analysis["improvements"],
                advice=analysis["advice"],
                performance=performance,
                percentile=percentile,
            )

            report.fit_score = final_fit
            report.strengths = analysis["strengths"]
            report.improvements = analysis["improvements"]
            report.advice = analysis["advice"]
            report.pdf_path = str(pdf_path)
            report.status = "done"
            await session.commit()
        except Exception:  # noqa: BLE001
            logger.exception("리포트 생성 실패 (id=%d)", report_id)
            # DB-레이어 오류였다면 세션이 무효 상태 — rollback 없이 status 커밋을 시도하면
            # PendingRollbackError로 실패해 status가 pending에 영구히 남아 프론트가 무한 폴링한다.
            await session.rollback()
            report = await session.get(Report, report_id)
            if report is not None:
                report.status = "failed"
                await session.commit()


async def get_owned_report(
    session: AsyncSession, report_id: int, user: User
) -> Report:
    report = await session.get(Report, report_id)
    if report is None or report.user_id != user.id:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없음")
    return report
