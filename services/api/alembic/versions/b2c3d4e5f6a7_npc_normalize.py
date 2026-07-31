"""NPC 정규화 — npc_personas → npcs(고유) + npc_placements(배치), messages.npc_id 추가

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-13

NPC를 고유정보(성격·선호·말버릇 등 프롬프트 재료)와 시나리오별 배치정보(역할·직급·담당업무·
등장)로 분리. 대화기록은 이름 대신 npc_id로 참조(길이·표시와 무관하게 안정). 완성 프롬프트를
DB에 통째 저장하던 system_prompt는 제거 — 코드 템플릿이 필드를 조립한다.
콘텐츠(npc/placement 행)는 재기동 시 seed가 YAML에서 다시 채운다.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "npcs",
        sa.Column("npc_id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("personality", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("likes", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("dislikes", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("speech_habits", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.create_table(
        "npc_placements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scenario_id", sa.Integer(), sa.ForeignKey("scenarios.id"), nullable=False),
        sa.Column("npc_id", sa.String(length=64), sa.ForeignKey("npcs.npc_id"), nullable=False),
        sa.Column("role", sa.String(length=80), nullable=False),
        sa.Column("rank", sa.String(length=50), nullable=True),
        sa.Column("responsibilities", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("appearance", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.UniqueConstraint("scenario_id", "npc_id"),
    )
    op.create_index("ix_npc_placements_npc_id", "npc_placements", ["npc_id"])
    op.add_column("messages", sa.Column("npc_id", sa.String(length=64), nullable=True))
    op.create_index("ix_messages_npc_id", "messages", ["npc_id"])
    op.drop_table("npc_personas")


def downgrade() -> None:
    op.create_table(
        "npc_personas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scenario_id", sa.Integer(), sa.ForeignKey("scenarios.id"), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("rank", sa.String(length=50), nullable=False),
        sa.Column("personality", sa.Text(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.UniqueConstraint("scenario_id", "name"),
    )
    op.drop_index("ix_messages_npc_id", "messages")
    op.drop_column("messages", "npc_id")
    op.drop_index("ix_npc_placements_npc_id", "npc_placements")
    op.drop_table("npc_placements")
    op.drop_table("npcs")
