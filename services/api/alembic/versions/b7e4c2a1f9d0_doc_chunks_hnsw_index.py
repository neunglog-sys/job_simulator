"""doc_chunks HNSW 벡터 인덱스 — cosine KNN 전체스캔 → 근사 인덱스 검색

Revision ID: b7e4c2a1f9d0
Revises: a7c3e9f10b2d
Create Date: 2026-07-15

RAG 검색(search_knowledge)이 `embedding <=> qvec`를 매번 doc_chunks 전체 순차스캔하던 것을
HNSW(vector_cosine_ops) 인덱스로 전환한다. 현재 540청크에선 순차스캔도 즉시지만, 코퍼스가
커질수록 O(n)이라 헤드룸이 없다. HNSW는 근사 KNN이라 규모와 무관하게 빠르다.

pgvector >= 0.5 필요(현 배포 0.8.2). 벡터 차원 1536 < HNSW 상한 2000 → 적용 가능.
CREATE INDEX CONCURRENTLY는 alembic의 트랜잭션 안에서 못 쓰므로 일반 CREATE(짧은 락) 사용 —
현 규모에선 인덱스 빌드가 순식간이라 문제 없음.
"""

from alembic import op

revision = "b7e4c2a1f9d0"
down_revision = "a7c3e9f10b2d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_doc_chunks_embedding_hnsw "
        "ON doc_chunks USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_doc_chunks_embedding_hnsw")
