"""NPC 동기화 — data/npcs/*.yaml(단일 원본) → DB(npcs 고유 + npc_placements 배치).

원칙: 사람은 YAML만 수정하고 DB는 자동 복사본. source_hash로 변경 감지(안 바뀌면 skip),
YAML에서 빠진 NPC는 삭제 대신 is_active=false(대화기록 npc_id 참조 보호).
apply=False면 DB를 건드리지 않고 리포트만 낸다(dry-run) — 공용 DB 사고 방지.
"""

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Npc, NpcPlacement, Scenario


def npc_hash(npc: dict) -> str:
    """NPC 엔트리(고유+배치 필드 전체) 내용 해시 — 안 바뀌면 재적재 skip."""
    return hashlib.sha256(
        json.dumps(npc, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


async def _upsert_npc(session: AsyncSession, npc: dict, digest: str) -> None:
    now = datetime.now(timezone.utc)
    fields = {
        "name": npc["name"],
        "personality": npc.get("personality") or [],
        "likes": npc.get("likes") or [],
        "dislikes": npc.get("dislikes") or [],
        "speech_habits": npc.get("speech_habits") or [],
        "source_hash": digest,
        "is_active": True,
        "synced_at": now,
    }
    await session.execute(
        insert(Npc)
        .values(npc_id=npc["npc_id"], **fields)
        .on_conflict_do_update(index_elements=[Npc.npc_id], set_=fields)
    )


async def _upsert_placement(session: AsyncSession, scenario_id: int, npc: dict) -> None:
    fields = {
        "role": npc["role"],
        "rank": npc.get("rank"),
        "responsibilities": npc.get("responsibilities") or [],
        "appearance": npc.get("appearance") or {},
    }
    await session.execute(
        insert(NpcPlacement)
        .values(scenario_id=scenario_id, npc_id=npc["npc_id"], **fields)
        .on_conflict_do_update(
            index_elements=[NpcPlacement.scenario_id, NpcPlacement.npc_id], set_=fields
        )
    )


async def sync_npcs(
    session: AsyncSession,
    npcs_by_slug: dict[str, list[dict]],
    *,
    apply: bool,
) -> dict:
    """YAML npcs → DB. apply=False면 dry-run(리포트만). → {new, changed, unchanged, deactivated}."""
    scenario_ids = {
        slug: sid
        for sid, slug in (await session.execute(select(Scenario.id, Scenario.slug))).all()
    }
    existing = {n.npc_id: n for n in (await session.execute(select(Npc))).scalars()}
    report = {"new": 0, "changed": 0, "unchanged": 0, "deactivated": 0}
    seen: set[str] = set()

    for slug, npcs in npcs_by_slug.items():
        scenario_id = scenario_ids.get(slug)
        if scenario_id is None:  # 짝 시나리오가 아직 DB에 없음 — seed 순서상 없어야 정상
            continue
        yaml_ids = {n["npc_id"] for n in npcs}
        for npc in npcs:
            nid = npc["npc_id"]
            seen.add(nid)
            digest = npc_hash(npc)
            prev = existing.get(nid)
            changed = prev is None or prev.source_hash != digest or not prev.is_active
            report["new" if prev is None else ("changed" if changed else "unchanged")] += 1
            if apply:
                if changed:
                    await _upsert_npc(session, npc, digest)
                await _upsert_placement(session, scenario_id, npc)
        if apply:  # 이 시나리오에서 YAML에 없어진 배치 제거 (배치는 하드, 정체성은 soft)
            await session.execute(
                delete(NpcPlacement).where(
                    NpcPlacement.scenario_id == scenario_id,
                    NpcPlacement.npc_id.notin_(yaml_ids),
                )
            )

    # YAML 어디에도 없는 NPC → 비활성 (삭제하면 대화기록 npc_id가 깨짐)
    missing = [nid for nid, n in existing.items() if nid not in seen and n.is_active]
    report["deactivated"] = len(missing)
    if apply and missing:
        await session.execute(update(Npc).where(Npc.npc_id.in_(missing)).values(is_active=False))

    if apply:
        await session.commit()
    return report
