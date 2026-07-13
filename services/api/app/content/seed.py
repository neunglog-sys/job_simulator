"""기동 시 data/ 콘텐츠를 DB에 업서트."""

import logging

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_jobs, load_scenarios
from app.models import Job, Npc, NpcPlacement, Scenario

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

        scenario_id = (
            await session.execute(select(Scenario.id).where(Scenario.slug == sc["slug"]))
        ).scalar_one()

        # NPC 배치는 통째로 교체 — YAML에서 빠진(rename/삭제) 배치가 잔존하지 않게.
        await session.execute(
            delete(NpcPlacement).where(NpcPlacement.scenario_id == scenario_id)
        )
        for npc in sc["npcs"]:
            # 고유정보(npcs) upsert — 같은 npc_id를 여러 시나리오가 공유할 수 있음
            stmt = insert(Npc).values(
                npc_id=npc["npc_id"], name=npc["name"],
                personality=npc.get("personality") or [],
                likes=npc.get("likes") or [],
                dislikes=npc.get("dislikes") or [],
                speech_habits=npc.get("speech_habits") or [],
            ).on_conflict_do_update(
                index_elements=[Npc.npc_id],
                set_={"name": npc["name"], "personality": npc.get("personality") or [],
                      "likes": npc.get("likes") or [], "dislikes": npc.get("dislikes") or [],
                      "speech_habits": npc.get("speech_habits") or []},
            )
            await session.execute(stmt)
            # 배치정보(npc_placements)
            session.add(NpcPlacement(
                scenario_id=scenario_id, npc_id=npc["npc_id"], role=npc["role"],
                rank=npc.get("rank"), responsibilities=npc.get("responsibilities") or [],
                appearance=npc.get("appearance") or {},
            ))

    await session.flush()
    # 어떤 배치에서도 참조되지 않는 고아 NPC 정리 (rename/삭제 누적 방지)
    referenced = set((await session.execute(select(NpcPlacement.npc_id))).scalars())
    orphans = [n for n in (await session.execute(select(Npc.npc_id))).scalars() if n not in referenced]
    if orphans:
        await session.execute(delete(Npc).where(Npc.npc_id.in_(orphans)))

    await session.commit()
    logger.info("콘텐츠 시드 완료: 직무 %d개, 시나리오 %d개", len(jobs), len(scenarios))
