"""기동 시 data/ 콘텐츠를 DB에 업서트."""

import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_jobs, load_scenarios
from app.content.npc_sync import sync_npcs
from app.models import Job, Scenario

logger = logging.getLogger(__name__)


async def seed_content(session: AsyncSession) -> None:
    jobs = load_jobs()
    scenarios, npcs_by_slug = load_scenarios()

    for job in jobs:
        stmt = insert(Job).values(
            code=job["code"],
            title=job["title"],
            description=job["description"],
            competencies=job["competencies"],
            interest_profile=job.get("interest_profile", {}),
            education_requirement=job.get("education_requirement"),
            salary=job.get("salary"),
            certifications=job.get("certifications", []),
            status=job.get("status"),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[Job.code],
            set_={
                "title": stmt.excluded.title,
                "description": stmt.excluded.description,
                "competencies": stmt.excluded.competencies,
                "interest_profile": stmt.excluded.interest_profile,
                "education_requirement": stmt.excluded.education_requirement,
                "salary": stmt.excluded.salary,
                "certifications": stmt.excluded.certifications,
                "status": stmt.excluded.status,
            },
        )
        await session.execute(stmt)

    job_ids = {
        code: id_
        for id_, code in (await session.execute(select(Job.id, Job.code))).all()
    }

    for sc in scenarios:
        if sc["job"] not in job_ids:
            raise ValueError(f"시나리오 '{sc['slug']}'가 참조하는 직무 '{sc['job']}' 없음")
        stmt = insert(Scenario).values(
            job_id=job_ids[sc["job"]],
            slug=sc["slug"],
            title=sc["title"],
            module=sc.get("module"),
            initial_state=sc["initial_state"],
            steps=sc["steps"],
            sudden_quest=sc.get("sudden_quest"),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[Scenario.slug],
            set_={
                "job_id": stmt.excluded.job_id,
                "title": stmt.excluded.title,
                "module": stmt.excluded.module,
                "initial_state": stmt.excluded.initial_state,
                "steps": stmt.excluded.steps,
                "sudden_quest": stmt.excluded.sudden_quest,
            },
        )
        await session.execute(stmt)

    await session.commit()  # NPC 동기화는 시나리오(FK 대상)가 먼저 커밋돼야 함
    # NPC: 별도 원본(data/npcs) → source_hash 변경감지 + soft-delete로 동기화
    report = await sync_npcs(session, npcs_by_slug, apply=True)
    logger.info(
        "콘텐츠 시드 완료: 직무 %d개, 시나리오 %d개, NPC 신규 %d·수정 %d·비활성 %d",
        len(jobs), len(scenarios), report["new"], report["changed"], report["deactivated"],
    )
