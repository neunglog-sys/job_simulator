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
    # 멱등: jobs.dimension_weights 가 이미 있으면(로컬에서 먼저 추가된 경우 등) 다시 추가하지 않는다
    # — 비멱등 add_column 이 DuplicateColumn 으로 배포를 깨뜨리던 문제 방지.
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('jobs')}
    if 'dimension_weights' in cols:
        return
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
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('jobs')}
    if 'dimension_weights' not in cols:
        return
    op.drop_column('jobs', 'dimension_weights')
