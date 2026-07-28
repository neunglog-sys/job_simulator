"""직무지식 검색 평가 — 옛 기준(청크 1개)과 새 기준(동등 청크 집합)을 나란히 잰다.

보고된 '직무 오염 35.4%'에 평가 기준 탓 오탐이 얼마나 섞였는지 확인하는 것이 목적이다.
검색은 한 번만 돌리고 채점만 두 방식으로 한다 — 같은 결과를 두 자로 재는 것이라
차이가 그대로 '기준 때문에 생긴 오탐'이 된다.

    옛 기준: gt_chunk_id 하나만 정답
    새 기준: exact_job은 그 직무만, 나머지는 acceptable_chunk_ids(본문 동일 청크) 전부

`--mode prod`는 채점 기준 비교 대신 상담 실경로를 그대로 태운다. 거리컷·게이트·
scope_chunks(단일 직무 붕괴)·전역 재시도까지 붙여, "정답 근거가 실제로 프롬프트에
주입되는가"를 잰다 — 순수 검색 순위(raw)와는 다른 질문이다.

실행:
    docker compose exec api python -m app.scripts.eval_retrieval
    docker compose exec api python -m app.scripts.eval_retrieval --mode prod
    docker compose exec api python -m app.scripts.eval_retrieval --mode prod --scope family
"""

import argparse
import asyncio
import json
import logging
import re
from collections import Counter
from pathlib import Path

from sqlalchemy import select

from app.content.knowledge import search_knowledge
from app.core.config import settings
from app.core.db import SessionFactory
from app.domains.consultation import rag_gate
from app.domains.consultation.service import (
    GENERAL_KB_SCOPE,
    RAG_EMBED_TIMEOUT_S,
    RAG_MAX_DISTANCE,
    RAG_SCOPE_CANDIDATES,
    RAG_TOP_K,
)
from app.models import DocChunk

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

GOLDEN_PATH = Path(settings.data_dir) / "evaluation" / "golden" / "job_knowledge_40.json"
HEADER_RE = re.compile(r"^\[([^/\]]+)/([^/\]]+)/([^\]]+)\]\s*(.+?):")


def _family_of(content: str) -> str | None:
    m = HEADER_RE.match(content or "")
    return m.group(2).strip() if m else None


def _stage_of(content: str) -> str | None:
    m = HEADER_RE.match(content or "")
    return m.group(4).strip() if m else None


async def evaluate(top_k: int) -> dict:
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    scored = [g for g in golden if g.get("kind") != "chunk_missing"]

    old_hit1 = new_hit1 = 0
    old_hitk = new_hitk = 0
    old_job_contam = new_job_contam = 0
    fam_contam = stage_miss = 0
    kind_stats: dict[str, Counter] = {}
    flipped: list[dict] = []
    stage_confusion: Counter = Counter()

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
            got_stage = _stage_of(top.content)
            if got_stage != item.get("gt_stage"):
                stage_miss += 1
                stage_confusion[f"{item.get('gt_stage')} → {got_stage}"] += 1

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
        "stage_miss": stage_miss / n,
        "stage_confusion": stage_confusion,
        "kind_stats": kind_stats,
        "flipped": flipped,
    }


async def _family_scope(session) -> dict[str, list[str]]:
    """직무군 이름 → 소속 J코드들. 상담 스코프는 추천 F의 members로 만들어지므로 그 모양을 흉내낸다."""
    rows = (await session.execute(select(DocChunk.job_code, DocChunk.content))).all()
    out: dict[str, set[str]] = {}
    for job_code, content in rows:
        fam = _family_of(content)
        if fam and job_code:
            out.setdefault(fam, set()).add(job_code)
    return {k: sorted(v) for k, v in out.items()}


async def evaluate_prod(
    scope_mode: str, embed_timeout: float, candidates_k: int, inject_k: int
) -> dict:
    """상담 _fetch_knowledge 경로를 그대로 재현 — 게이트·컷·scope_chunks·전역 재시도.

    임베딩 타임아웃도 실경로 그대로 둔다. 상담은 초과 시 지식 없이 진행하므로
    타임아웃은 '검색 실패'가 아니라 '주입 안 됨'으로 세야 실제 손실이 보인다.
    """
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    scored = [g for g in golden if g.get("kind") != "chunk_missing"]

    gated_out = injected = correct = empty_after_scope = retried = timed_out = 0
    label_mismatch = 0
    injected_sizes: Counter = Counter()
    misses: list[dict] = []
    label_examples: list[str] = []

    async with SessionFactory() as session:
        fam_map = await _family_scope(session) if scope_mode == "family" else {}
        for item in scored:
            acceptable = set(item.get("acceptable_chunk_ids") or [])
            if item.get("kind") == "exact_job":
                acceptable = {item["gt_chunk_id"]}

            if not rag_gate.should_run_rag(item["q"]):
                gated_out += 1
                misses.append({"why": "게이트 탈락", "q": item["q"][:60]})
                continue

            scope = None
            if scope_mode == "family":
                members = fam_map.get(item.get("gt_family") or "", [])
                scope = [*members, GENERAL_KB_SCOPE] if members else None

            try:
                candidates = await search_knowledge(
                    session, item["q"], job_code=scope,
                    top_k=candidates_k, max_distance=RAG_MAX_DISTANCE,
                    embed_timeout=embed_timeout,
                )
                chunks = rag_gate.scope_chunks(candidates, top_k=inject_k)
                if scope and not chunks:
                    retried += 1
                    candidates = await search_knowledge(
                        session, item["q"],
                        top_k=candidates_k, max_distance=RAG_MAX_DISTANCE,
                        embed_timeout=embed_timeout,
                    )
                    chunks = rag_gate.scope_chunks(candidates, top_k=inject_k)
            except asyncio.TimeoutError:
                timed_out += 1
                misses.append({"why": f"임베딩 {embed_timeout}s 초과", "q": item["q"][:60]})
                continue

            if not chunks:
                empty_after_scope += 1
                misses.append({"why": "지배 직무 없음 → 주입 생략", "q": item["q"][:60]})
                continue

            injected += 1
            injected_sizes[len(chunks)] += 1

            # 본문이 같아도 머리말 [직무명/...]은 다르고, 그게 그대로 프롬프트에 들어간다.
            # 근거 내용은 맞지만 LLM이 엉뚱한 직무명을 말할 여지가 남으므로 따로 센다
            # ('같은 F 내 재순위화'가 실제로 잡을 대상이 있는지는 이 수치로 판단해야 한다).
            if item["gt_job_code"] not in {c.job_code for c in chunks}:
                label_mismatch += 1
                label_examples.append(
                    f"{item['gt_job_code']} {item.get('gt_job_name', '')}"
                    f" ← 머리말 {sorted({c.job_code for c in chunks})}"
                )

            if acceptable & {c.id for c in chunks}:
                correct += 1
            else:
                # 주입은 단일 직무로 붕괴된다 — 그 직무가 맞는데 정답 청크가 없으면
                # 직무 오염이 아니라 단계 오답이다. 둘은 처방이 다르므로 나눠 센다.
                got_jobs = {c.job_code for c in chunks}
                acceptable_jobs = set(item.get("acceptable_job_codes") or [])
                if item.get("kind") == "exact_job":
                    acceptable_jobs = {item["gt_job_code"]}
                if got_jobs & acceptable_jobs:
                    why = f"단계 오답(직무는 맞음) — 주입 {sorted(_stage_of(c.content) or '?' for c in chunks)}"
                else:
                    why = f"직무 오답 — 주입 {sorted(got_jobs)}"
                misses.append({
                    "why": why,
                    "q": item["q"][:60],
                    "gt": f"{item['gt_job_code']} {item.get('gt_job_name', '')} / {item.get('gt_stage')}",
                })

    n = len(scored)
    return {
        "n": n, "gated_out": gated_out, "empty": empty_after_scope, "retried": retried,
        "timed_out": timed_out, "injected": injected, "correct": correct,
        "label_mismatch": label_mismatch, "label_examples": label_examples,
        "sizes": injected_sizes, "misses": misses,
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--mode", choices=("raw", "prod"), default="raw")
    parser.add_argument(
        "--scope", choices=("none", "family"), default="none",
        help="prod 모드 스코프 — none은 추천 전, family는 추천이 정확히 맞았을 때",
    )
    parser.add_argument(
        "--embed-timeout", type=float, default=RAG_EMBED_TIMEOUT_S,
        help="임베딩 타임아웃 — 검색 로직만 보고 싶을 때 넉넉히 주면 타임아웃 손실이 빠진다",
    )
    parser.add_argument("--candidates", type=int, default=RAG_SCOPE_CANDIDATES)
    parser.add_argument("--inject", type=int, default=RAG_TOP_K)
    args = parser.parse_args()

    if args.mode == "prod":
        p = await evaluate_prod(
            args.scope, args.embed_timeout, args.candidates, args.inject
        )
        n = p["n"]
        logger.info(
            "상담 실경로 · %d건 · 컷 %.2f · 후보 %d → 주입 %d · 스코프=%s · 임베딩컷 %.1fs",
            n, RAG_MAX_DISTANCE, args.candidates, args.inject, args.scope, args.embed_timeout,
        )
        logger.info("")
        logger.info("%-28s %4d  %5.1f%%", "임베딩 타임아웃", p["timed_out"], p["timed_out"] / n * 100)
        logger.info("%-28s %4d  %5.1f%%", "게이트 탈락(RAG 미실행)", p["gated_out"], p["gated_out"] / n * 100)
        logger.info("%-28s %4d  %5.1f%%", "지배 직무 없음 → 주입 생략", p["empty"], p["empty"] / n * 100)
        logger.info("%-28s %4d  %5.1f%%", "지식 주입됨", p["injected"], p["injected"] / n * 100)
        logger.info("%-28s %4d  %5.1f%%", "└ 정답 근거 포함", p["correct"], p["correct"] / n * 100)
        if args.scope == "family":
            logger.info("%-28s %4d", "스코프 빈손 → 전역 재시도", p["retried"])
        logger.info("%-28s %s", "주입 청크 수 분포", dict(sorted(p["sizes"].items())))
        logger.info(
            "%-28s %4d  %5.1f%%  (본문은 동일)",
            "머리말 직무명 불일치", p["label_mismatch"], p["label_mismatch"] / n * 100,
        )
        for ex in p["label_examples"]:
            logger.info("    %s", ex)
        if p["misses"]:
            logger.info("")
            logger.info("정답 근거가 안 들어간 %d건", len(p["misses"]))
            for m in p["misses"]:
                logger.info("  [%s] %s", m["why"], m.get("gt", m["q"]))
        return 0

    r = await evaluate(args.top_k)
    n = r["n"]
    logger.info("골든셋 %d건 · top_k=%d · 전역 검색(스코프 없음)", n, args.top_k)
    logger.info("")
    logger.info("%-22s %10s %10s", "", "옛 기준", "새 기준")
    logger.info("%-22s %9.1f%% %9.1f%%", "Recall@1", r["old"]["r1"] * 100, r["new"]["r1"] * 100)
    logger.info("%-22s %9.1f%% %9.1f%%", f"Recall@{args.top_k}", r["old"]["rk"] * 100, r["new"]["rk"] * 100)
    logger.info("%-22s %9.1f%% %9.1f%%", "직무 오염(top-1)", r["old"]["job_contam"] * 100, r["new"]["job_contam"] * 100)
    logger.info("%-22s %9.1f%%", "직무군 오염(top-1)", r["family_contam"] * 100)
    logger.info("%-22s %9.1f%%", "단계 오답(top-1)", r["stage_miss"] * 100)

    if r["stage_confusion"]:
        logger.info("")
        logger.info("단계 혼동 (정답 → 검색)")
        for pair, cnt in r["stage_confusion"].most_common():
            logger.info("  %-40s %d", pair, cnt)

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
