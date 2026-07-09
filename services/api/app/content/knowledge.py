"""직무 지식 적재 파이프라인 (RAG).

data/knowledge/<job_code>/*.md|txt 파일을 청크로 쪼개 임베딩 후 doc_chunks에 저장.
파일 내용 sha256이 그대로면 스킵 → 재기동해도 바뀐 파일만 임베딩 (비용 절약).
"""

import hashlib
import logging
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm import get_llm
from app.models import DocChunk

logger = logging.getLogger(__name__)

CHUNK_CHARS = 800
CHUNK_OVERLAP = 100
EMBED_BATCH = 64


def split_chunks(text: str) -> list[str]:
    """문단 경계 기준으로 ~CHUNK_CHARS 크기 청크 분할 (긴 문단은 강제 분할)."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 2 <= CHUNK_CHARS:
            buf = f"{buf}\n\n{p}" if buf else p
            continue
        if buf:
            chunks.append(buf)
        while len(p) > CHUNK_CHARS:  # 청크보다 긴 문단은 오버랩 두고 강제 분할
            chunks.append(p[:CHUNK_CHARS])
            p = p[CHUNK_CHARS - CHUNK_OVERLAP :]
        buf = p
    if buf:
        chunks.append(buf)
    return chunks


async def ingest_knowledge(session: AsyncSession) -> None:
    base = Path(settings.data_dir) / "knowledge"
    if not base.exists():
        return

    ingested = skipped = 0
    for path in sorted(list(base.glob("*/*.md")) + list(base.glob("*/*.txt"))):
        job_code = path.parent.name
        source = f"{job_code}/{path.name}"
        text = path.read_text(encoding="utf-8")
        file_hash = hashlib.sha256(text.encode()).hexdigest()

        existing_hash = (
            await session.execute(
                select(DocChunk.file_hash).where(DocChunk.source == source).limit(1)
            )
        ).scalar_one_or_none()
        if existing_hash == file_hash:
            skipped += 1
            continue

        chunks = split_chunks(text)
        if not chunks:
            continue
        vectors: list[list[float]] = []
        for i in range(0, len(chunks), EMBED_BATCH):
            vectors.extend(await get_llm().embed(chunks[i : i + EMBED_BATCH]))

        # 변경된 파일은 통째로 교체
        await session.execute(delete(DocChunk).where(DocChunk.source == source))
        for chunk, vector in zip(chunks, vectors):
            session.add(
                DocChunk(
                    job_code=job_code,
                    source=source,
                    file_hash=file_hash,
                    content=chunk,
                    embedding=vector,
                )
            )
        ingested += 1
        logger.info("지식 적재: %s (%d청크)", source, len(chunks))

    await session.commit()
    if ingested or skipped:
        logger.info("지식 적재 완료: 신규/변경 %d개 파일, 스킵 %d개", ingested, skipped)


async def search_knowledge(
    session: AsyncSession, query: str, job_code: str | None = None, top_k: int = 5
) -> list[DocChunk]:
    """질의 임베딩 → 코사인 거리 기준 top-k 청크."""
    [qvec] = await get_llm().embed([query])
    stmt = select(DocChunk)
    if job_code:
        stmt = stmt.where(DocChunk.job_code == job_code)
    stmt = stmt.order_by(DocChunk.embedding.cosine_distance(qvec)).limit(top_k)
    return list((await session.execute(stmt)).scalars())
