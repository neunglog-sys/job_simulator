"""직무지식 검색 평가 — 옛 기준(청크 1개)과 새 기준(동등 청크 집합)을 나란히 잰다.

보고된 '직무 오염 35.4%'에 평가 기준 탓 오탐이 얼마나 섞였는지 확인하는 것이 목적이다.
검색은 한 번만 돌리고 채점만 두 방식으로 한다 — 같은 결과를 두 자로 재는 것이라
차이가 그대로 '기준 때문에 생긴 오탐'이 된다.

    옛 기준: gt_chunk_id 하나만 정답
    새 기준: exact_job은 그 직무만, 나머지는 acceptable_chunk_ids(본문 동일 청크) 전부

실행:
    docker compose exec api python -m app.scripts.eval_retrieval
    docker compose exec api python -m app.scripts.eval_retrieval --top-k 5
"""

import argparse
import asyncio
import json
import logging
import re
from collections import Counter
from pathlib import Path

from app.content.knowledge import search_knowledge
from app.core.config import settings
from app.core.db import SessionFactory

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

GOLDEN_PATH = Path(settings.data_dir) / "evaluation" / "golden" / "job_knowledge_40.json"
HEADER_RE = re.compile(r"^\[([^/\]]+)/([^/\]]+)/([^\]]+)\]")


def _family_of(content: str) -> str | None:
    m = HEADER_RE.match(content or "")
    return m.group(2).strip() if m else None


async def evaluate(top_k: int) -> dict:
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    scored = [g for g in golden if g.get("kind") != "chunk_missing"]

    old_hit1 = new_hit1 = 0
    old_hitk = new_hitk = 0
    old_job_contam = new_job_contam = 0
    fam_contam = 0
    kind_stats: dict[str, Counter] = {}
    flipped: list[dict] = []

    async with SessionFactory() as session:
        for item in scored:
            kind = item.get("kind", "family_only")
            acceptable_ids = set(item.get("acceptable_chunk_ids") or [])
            acceptable_jobs = set(item.get("acceptable_job_codes") or [])
            gt_id = item.get("gt_chunk_id")
            gt_job = item.get("gt_job_code")

            # exact_job은 질문이 그 직무를 콕 집었으므로 동등 청크를 인정하지 않는다
            if kind == "exact_job":
                acceptable_ids = {gt_id} if gt_id is not None else set()
                acceptable_jobs = {gt_job} if gt_job else set()

            chunks = await search_knowledge(session, item["q"], top_k=top_k)
            if not chunks:
                continue
            top = chunks[0]
            ids = [c.id for c in chunks]

            old_ok1 = top.id == gt_id
            new_ok1 = top.id in acceptable_ids
            old_okk = gt_id in ids
            new_okk = bool(acceptable_ids & set(ids))

            old_hit1 += old_ok1
            new_hit1 += new_ok1
            old_hitk += old_okk
            new_hitk += new_okk
            old_job_contam += top.job_code != gt_job
            new_job_contam += top.job_code not in acceptable_jobs
            if _family_of(top.content) != item.get("gt_family"):
                fam_contam += 1

            stat = kind_stats.setdefault(kind, Counter())
            stat["n"] += 1
            stat["old_ok"] += old_ok1
            stat["new_ok"] += new_ok1

            if new_ok1 and not old_ok1:
                flipped.append({
                    "q": item["q"][:70],
                    "gt": f"{gt_job} {item.get('gt_job_name', '')}",
                    "got": f"{top.job_code} {(_family_of(top.content) or '')}",
                    "kind": kind,
                })

    n = len(scored)
    return {
        "n": n,
        "old": {"r1": old_hit1 / n, "rk": old_hitk / n, "job_contam": old_job_contam / n},
        "new": {"r1": new_hit1 / n, "rk": new_hitk / n, "job_contam": new_job_contam / n},
        "family_contam": fam_contam / n,
        "kind_stats": kind_stats,
        "flipped": flipped,
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args()

    r = await evaluate(args.top_k)
    n = r["n"]
    logger.info("골든셋 %d건 · top_k=%d · 전역 검색(스코프 없음)", n, args.top_k)
    logger.info("")
    logger.info("%-22s %10s %10s", "", "옛 기준", "새 기준")
    logger.info("%-22s %9.1f%% %9.1f%%", "Recall@1", r["old"]["r1"] * 100, r["new"]["r1"] * 100)
    logger.info("%-22s %9.1f%% %9.1f%%", f"Recall@{args.top_k}", r["old"]["rk"] * 100, r["new"]["rk"] * 100)
    logger.info("%-22s %9.1f%% %9.1f%%", "직무 오염(top-1)", r["old"]["job_contam"] * 100, r["new"]["job_contam"] * 100)
    logger.info("%-22s %9.1f%%", "직무군 오염(top-1)", r["family_contam"] * 100)

    logger.info("")
    logger.info("분류별 Recall@1")
    for kind, s in sorted(r["kind_stats"].items()):
        logger.info(
            "  %-15s n=%-3d 옛 %5.1f%%  새 %5.1f%%",
            kind, s["n"], s["old_ok"] / s["n"] * 100, s["new_ok"] / s["n"] * 100,
        )

    if r["flipped"]:
        logger.info("")
        logger.info("기준 때문에 오답이던 것 (%d건) — 동등 근거가 검색됐는데 틀렸다고 셌던 사례", len(r["flipped"]))
        for f in r["flipped"][:8]:
            logger.info("  [%s] 정답 %s ← 검색 %s", f["kind"], f["gt"], f["got"])
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
