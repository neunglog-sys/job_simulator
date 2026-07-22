"""simulation consultation_id column

체험(Simulation)이 어느 상담에서 시작됐는지 DB에 보관 — 마이페이지 '이어하기'로
재개해 URL 파라미터가 유실돼도 완주 리포트가 상담을 붙일 수 있게. nullable 추가 컬럼.

Revision ID: c1a2b3d4e5f6
Revises: f7c2a8d4e901
Create Date: 2026-07-22 17:55:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, None] = "f7c2a8d4e901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 멱등: 이미 있으면(로컬에서 먼저 추가된 경우 등) 다시 추가하지 않는다.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("simulations")}
    if "consultation_id" in cols:
        return
    op.add_column(
        "simulations",
        sa.Column("consultation_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_simulations_consultation_id",
        "simulations",
        "consultations",
        ["consultation_id"],
        ["id"],
    )
    op.create_index(
        "ix_simulations_consultation_id", "simulations", ["consultation_id"]
    )


def downgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("simulations")}
    if "consultation_id" not in cols:
        return
    op.drop_index("ix_simulations_consultation_id", table_name="simulations")
    op.drop_constraint(
        "fk_simulations_consultation_id", "simulations", type_="foreignkey"
    )
    op.drop_column("simulations", "consultation_id")
