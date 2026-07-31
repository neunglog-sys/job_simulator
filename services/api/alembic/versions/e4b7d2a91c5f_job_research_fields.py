"""job research fields (education_requirement/salary/certifications/status)

Revision ID: e4b7d2a91c5f
Revises: a2f7c9e1b4d3
Create Date: 2026-07-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e4b7d2a91c5f'
down_revision: Union[str, None] = 'a2f7c9e1b4d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'jobs',
        sa.Column('education_requirement', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        'jobs',
        sa.Column('salary', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        'jobs',
        sa.Column(
            'certifications',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default='[]',
        ),
    )
    op.add_column(
        'jobs',
        sa.Column('status', sa.String(length=30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('jobs', 'status')
    op.drop_column('jobs', 'certifications')
    op.drop_column('jobs', 'salary')
    op.drop_column('jobs', 'education_requirement')
