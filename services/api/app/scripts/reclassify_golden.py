"""직무지식 골든셋 재분류 — 정답을 청크 1개가 아니라 '구별 불가능한 동등 청크 집합'으로.

## 왜 필요한가

doc_chunks의 J 청크는 이런 구조다.

    청크 515개 = 직무 103개 × 단계 5개
    단계: 업무요청 이해 / 자료·현황 확인 / 처리·제작·응대 / 검수·판단 / 보고·인계

그런데 머리말 `[직무명/직무군/유형]`을 떼면 **고유 본문이 120개뿐**이다
(= 직무군 24개 × 단계 5개). 즉 같은 직무군 안의 여러 직무가 **글자 단위로 똑같은
본문**을 공유한다. 515개 중 490개(95.1%)가 그렇다.

임베딩은 본문으로 거리를 재므로, 본문이 같으면 **어느 직무가 뽑히든 거리가 같다.**
그런데 기존 골든셋은 `gt_chunk_id` 하나만 정답으로 봐서, 똑같은 근거가 검색돼도
'직무 오염'으로 셌다. 보고된 직무 오염 35.4%에는 이 오탐이 섞여 있다.

## 분류

    exact_job       질문에 정답 직무명이 그대로 등장 → 그 직무만 정답 (엄격)
    wrong_job_hint  질문에 '다른' 직무명만 등장 → 질문이 잘못 만들어졌을 수 있음(검토)
    family_stage    직무군 표현은 있고 직무명은 없음 → 동등 본문 전부 정답
    family_only     직무 단서가 아예 없음 → 동등 본문 전부 정답

`acceptable_chunk_ids`는 정답 청크와 **본문이 글자 단위로 같은** 청크 전부다.
분류와 무관하게 항상 채워 두고, 채점 시 exact_job만 무시하면 된다.

실행(data/는 컨테이너에 읽기전용으로 붙으므로 컨테이너 안에서 바로 덮어쓸 수 없다):
    docker compose exec api python -m app.scripts.reclassify_golden
    docker compose exec api python -m app.scripts.reclassify_golden --out /tmp/golden.json
    docker compose cp api:/tmp/golden.json data/evaluation/golden/job_knowledge_40.json
"""

import argparse
import asyncio
import json
import logging
import re
from collections import Counter, defaultdict
from pathlib import Path

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionFactory
from app.models import DocChunk

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# 청크 머리말: [직무명/직무군/유형] 단계: 본문...
HEADER_RE = re.compile(r"^\[([^/\]]+)/([^/\]]+)/([^\]]+)\]\s*(.+?):")
J_CODE_RE = re.compile(r"J\d{3}")

GOLDEN_PATH = Path(settings.data_dir) / "evaluation" / "golden" / "job_knowledge_40.json"


def _strip_header(text: str) -> str:
    return re.sub(r"^\[[^\]]*\]\s*", "", text).strip()


async def load_chunks() -> dict[str, dict]:
    """본문(머리말 포함) → 청크 정보. 골든셋이 chunk_text로 참조하므로 그 키로 잡는다."""
    async with SessionFactory() as session:
        rows = (
            await session.execute(select(DocChunk.id, DocChunk.job_code, DocChunk.content))
        ).all()

    chunks: dict[str, dict] = {}
    for chunk_id, job_code, content in rows:
        header = HEADER_RE.match(content or "")
        if not header or not job_code or not J_CODE_RE.fullmatch(job_code):
            continue
        chunks[content.strip()] = {
            "id": chunk_id,
            "job_code": job_code,
            "job_name": header.group(1).strip(),
            "family": header.group(2).strip(),
            "stage": header.group(4).strip(),
            "body": _strip_header(content),
        }
    return chunks


def classify(question: str, target: dict, all_job_names: set[str]) -> tuple[str, list[str]]:
    """질문이 어느 직무를 가리키는지로 분류. 두 번째 값은 질문에 등장한 '다른' 직무명."""
    if target["job_name"] in question:
        return "exact_job", []

    # 다른 직무명이 들어 있으면 질문 자체가 그 직무를 가리킨다 — 정답과 어긋난 셈이다.
    # 짧은 이름이 우연히 부분일치하는 것을 막으려 2글자 이상만 본다.
    others = sorted(
        name for name in all_job_names
        if name != target["job_name"] and len(name) >= 2 and name in question
    )
    if others:
        return "wrong_job_hint", others

    # 직무군 표기는 '사무행정·총무'처럼 구분자로 묶여 있어 토큰 단위로 확인한다.
    family_tokens = [t for t in re.split(r"[·/]", target["family"]) if len(t) >= 2]
    if any(token in question for token in family_tokens):
        return "family_stage", []
    return "family_only", []


async def build() -> tuple[list[dict], Counter, list[dict]]:
    chunks = await load_chunks()
    all_job_names = {c["job_name"] for c in chunks.values()}

    # 본문이 같은 청크끼리 묶는다 — 검색이 구별할 수 없는 단위
    by_body: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks.values():
        by_body[chunk["body"]].append(chunk)

    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    out: list[dict] = []
    kinds: Counter = Counter()
    review: list[dict] = []

    for item in golden:
        target = chunks.get((item.get("chunk_text") or "").strip())
        if target is None:
            # 코퍼스에서 사라진 청크 — 조용히 넘기면 평가가 축소되므로 남긴다
            kinds["chunk_missing"] += 1
            out.append({**item, "kind": "chunk_missing"})
            continue

        kind, others = classify(item["q"], target, all_job_names)
        kinds[kind] += 1
        equals = sorted(by_body[target["body"]], key=lambda c: c["id"])

        # 기록된 gt_chunk_id는 코퍼스를 다시 적재하면서 어긋났다(전 건 불일치).
        # chunk_text로 찾은 실제 행 id로 바로잡고, 원래 값은 추적용으로 남긴다.
        entry = {
            **item,
            "gt_chunk_id": target["id"],
            "gt_chunk_id_legacy": item.get("gt_chunk_id_legacy", item.get("gt_chunk_id")),
            "gt_job_code": target["job_code"],
            "kind": kind,
            "gt_family": target["family"],
            "gt_stage": target["stage"],
            "gt_job_name": target["job_name"],
            "acceptable_chunk_ids": [c["id"] for c in equals],
            "acceptable_job_codes": sorted({c["job_code"] for c in equals}),
        }
        if others:
            entry["question_mentions_jobs"] = others
            review.append({"q": item["q"], "gt": target["job_name"], "mentions": others})
        out.append(entry)

    return out, kinds, review


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", help="결과 JSON 저장 경로 (없으면 미리보기만)")
    args = parser.parse_args()

    out, kinds, review = await build()

    logger.info("골든셋 %d건 재분류", len(out))
    for kind in ("exact_job", "wrong_job_hint", "family_stage", "family_only", "chunk_missing"):
        if kinds[kind]:
            logger.info("  %-15s %d", kind, kinds[kind])

    sizes = Counter(len(e.get("acceptable_chunk_ids") or []) for e in out if e.get("acceptable_chunk_ids"))
    logger.info("")
    logger.info("동등 청크 집합 크기 분포: %s", dict(sorted(sizes.items())))

    if review:
        logger.info("")
        logger.info("⚠️ 질문이 정답과 다른 직무를 가리킨다 — 문항 검토 필요 (%d건)", len(review))
        for r in review:
            logger.info("   정답=%s / 질문 언급=%s", r["gt"], ", ".join(r["mentions"]))
            logger.info("   %s", r["q"][:90])

    if args.out:
        Path(args.out).write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        logger.info("")
        logger.info("저장: %s", args.out)
    else:
        logger.info("")
        logger.info("(미리보기 — 저장하려면 --out 경로)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
