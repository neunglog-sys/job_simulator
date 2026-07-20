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
    op.add_column("consultations", sa.Column("title", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("consultations", "title")
