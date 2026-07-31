"""recommendation feedback column

Revision ID: a2f7c9e1b4d3
Revises: 7c1e9a4d2f6b
Create Date: 2026-07-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a2f7c9e1b4d3'
down_revision: Union[str, None] = '7c1e9a4d2f6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'recommendations',
        sa.Column('feedback', sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('recommendations', 'feedback')
