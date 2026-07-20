"""consultation custom title

Revision ID: e6b1c4d8a920
Revises: d9f3a7c1e820
Create Date: 2026-07-20 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6b1c4d8a920"
down_revision: Union[str, None] = "d9f3a7c1e820"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 멱등: 과거 유령 리비전 사고로 이 컬럼이 이미 물리적으로 존재하는 공용 DB가 있다.
    # 순수 add_column이면 그런 DB에서 DuplicateColumn으로 배포가 크래시하므로 IF NOT EXISTS로
    # 방어한다 — 컬럼이 있든(공용 DB) 없든(CI·새 로컬) 안전하게 통과한다.
    op.execute("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS title TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE consultations DROP COLUMN IF EXISTS title")
