"""npc sync tracking — source_hash / is_active / synced_at

Revision ID: d5e6f7a8b9c0
Revises: c32d61e63ba4
Create Date: 2026-07-14

NPC를 YAML 원본 → DB 복사본으로 동기화할 때: source_hash로 변경 감지(안 바뀌면 skip),
is_active로 YAML에서 빠진 NPC를 삭제 대신 비활성(대화기록 npc_id 참조 보호), synced_at 기록.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "c32d61e63ba4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("npcs", sa.Column("source_hash", sa.String(length=64), nullable=True))
    op.add_column(
        "npcs",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column("npcs", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("npcs", "synced_at")
    op.drop_column("npcs", "is_active")
    op.drop_column("npcs", "source_hash")
