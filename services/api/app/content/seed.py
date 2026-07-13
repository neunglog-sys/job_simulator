"""기동 시 data/ 콘텐츠를 DB에 업서트."""

import logging

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_jobs, load_scenarios
from app.models import Job, NpcPersona, Scenario

logger = logging.getLogger(__name__)


async def seed_content(session: AsyncSession) -> None:
    jobs = load_jobs()
    scenarios = load_scenarios()

    for job in jobs:
        stmt = insert(Job).values(
            code=job["code"],
            title=job["title"],
            description=job["description"],
            competencies=job["competencies"],
            interest_profile=job.get("interest_profile", {}),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[Job.code],
            set_={
                "title": stmt.excluded.title,
                "description": stmt.excluded.description,
                "competencies": stmt.excluded.competencies,
                "interest_profile": stmt.excluded.interest_profile,
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

        scenario_id = (
            await session.execute(select(Scenario.id).where(Scenario.slug == sc["slug"]))
        ).scalar_one()

        # YAML에서 사라진(이름 변경·삭제된) 페르소나는 제거 — build 경로처럼 roster를 교체.
        # (upsert만 하면 stale 페르소나가 영구 잔존하고, step이 옛 이름을 참조하면 404)
        current_names = [npc["name"] for npc in sc["npcs"]]
        await session.execute(
            delete(NpcPersona).where(
                NpcPersona.scenario_id == scenario_id,
                NpcPersona.name.notin_(current_names),
            )
        )

        for npc in sc["npcs"]:
            stmt = insert(NpcPersona).values(
                scenario_id=scenario_id,
                name=npc["name"],
                rank=npc["rank"],
                personality=npc["personality"],
                system_prompt=npc["system_prompt"],
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[NpcPersona.scenario_id, NpcPersona.name],
                set_={
                    "rank": stmt.excluded.rank,
                    "personality": stmt.excluded.personality,
                    "system_prompt": stmt.excluded.system_prompt,
                },
            )
            await session.execute(stmt)

    await session.commit()
    logger.info("콘텐츠 시드 완료: 직무 %d개, 시나리오 %d개", len(jobs), len(scenarios))
