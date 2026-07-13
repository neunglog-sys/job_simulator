"""widen messages.role to 64 (npc:{name} overflowed String(16))

Revision ID: a1b2c3d4e5f6
Revises: 7c1e9a4d2f6b
Create Date: 2026-07-13

일부 NPC 이름이 길어 role=f"npc:{name}"가 varchar(16)을 넘겨 대화 저장 시
StringDataRightTruncation으로 게임이 막히던 문제 수정. 폭이 넓어지는 방향이라
기존 데이터 손실 없음.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "7c1e9a4d2f6b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "messages", "role",
        existing_type=sa.String(length=16),
        type_=sa.String(length=64),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "messages", "role",
        existing_type=sa.String(length=64),
        type_=sa.String(length=16),
        existing_nullable=False,
    )
