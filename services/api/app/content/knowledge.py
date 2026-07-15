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
        if job_code == "kb-v5":
            # 예약된 접두사 — load_research가 kb-v5/% 를 통째로 삭제·재적재하므로
            # 이 이름의 지식 폴더를 허용하면 서로의 청크를 지우게 됨
            logger.warning("data/knowledge/kb-v5 폴더는 예약된 이름이라 건너뜀: %s", path)
            continue
        source = f"{job_code}/{path.name}"
        text = path.read_text(encoding="utf-8")
        # 스킵 키에 임베딩 프로바이더를 포함 — mock으로 먼저 적재된 뒤 실키(Gemini)로 바뀌면
        # 텍스트가 같아도 프로바이더가 달라 재임베딩된다. (안 그러면 mock 벡터가 영구 잔존해
        # 실키 질의와 거리 ~1.0 → RAG가 조용히 죽음)
        provider = get_llm().embedder.name
        file_hash = hashlib.sha256(f"{provider}\n{text}".encode()).hexdigest()

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
        for chunk, vector in zip(chunks, vectors, strict=True):
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
    session: AsyncSession,
    query: str,
    job_code: str | list[str] | None = None,
    top_k: int = 5,
    max_distance: float | None = None,
) -> list[DocChunk]:
    """질의 임베딩 → 코사인 거리 기준 top-k 청크.

    job_code: 검색 스코프. None이면 전체(아바타 상담용), 단일 str이면 그 직무 코드,
    리스트면 그 안에서 IN 검색(게임 NPC — 시나리오 slug→KB 직무군 J코드들). 빈 리스트는
    '스코프는 지정됐으나 대응 지식 없음(갭)'이므로 검색 없이 빈 결과를 준다(엉뚱한 직무
    지식이 전체검색으로 새어 들어가는 것을 방지).
    max_distance: 관련도 컷오프 (코사인 거리, 작을수록 유사). 잡담에 무관한
    지식이 끼어드는 걸 막을 때 사용. mock 임베딩은 거리가 ~1.0이라 자연히 걸러짐.
    """
    if isinstance(job_code, (list, tuple, set)):
        job_code = list(job_code)
        if not job_code:
            return []  # 빈 스코프 → RAG 미주입 (임베딩 호출도 생략)
    [qvec] = await get_llm().embed([query], task_type="RETRIEVAL_QUERY")
    distance = DocChunk.embedding.cosine_distance(qvec)
    stmt = select(DocChunk)
    if job_code:
        stmt = stmt.where(
            DocChunk.job_code.in_(job_code)
            if isinstance(job_code, list)
            else DocChunk.job_code == job_code
        )
    if max_distance is not None:
        stmt = stmt.where(distance < max_distance)
    stmt = stmt.order_by(distance).limit(top_k)
    return list((await session.execute(stmt)).scalars())
