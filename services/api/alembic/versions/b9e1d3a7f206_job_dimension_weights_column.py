"""job dimension_weights column

Revision ID: b9e1d3a7f206
Revises: a4f8c2e9b105
Create Date: 2026-07-21 09:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b9e1d3a7f206'
down_revision: Union[str, None] = 'a4f8c2e9b105'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'jobs',
        sa.Column(
            'dimension_weights',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default='{}',
        ),
    )


def downgrade() -> None:
    op.drop_column('jobs', 'dimension_weights')
