"""evidence table

Revision ID: a4f8c2e9b105
Revises: e6b1c4d8a920
Create Date: 2026-07-21 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a4f8c2e9b105'
down_revision: Union[str, None] = 'e6b1c4d8a920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'evidence',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('consultation_id', sa.Integer(), nullable=False),
        sa.Column('simulation_id', sa.Integer(), nullable=True),
        sa.Column('stage', sa.String(length=20), nullable=False),
        sa.Column('dimension_code', sa.String(length=50), nullable=False),
        sa.Column('source_type', sa.String(length=30), nullable=False),
        sa.Column('evidence_text', sa.Text(), nullable=False),
        sa.Column('value', sa.String(length=100), nullable=False),
        sa.Column('confidence', sa.Integer(), nullable=False),
        sa.Column('confirmed_by_user', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('conflict', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['consultation_id'], ['consultations.id']),
        sa.ForeignKeyConstraint(['simulation_id'], ['simulations.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_evidence_consultation_id'), 'evidence', ['consultation_id'], unique=False)
    op.create_index(op.f('ix_evidence_simulation_id'), 'evidence', ['simulation_id'], unique=False)
    op.create_index(op.f('ix_evidence_dimension_code'), 'evidence', ['dimension_code'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_evidence_dimension_code'), table_name='evidence')
    op.drop_index(op.f('ix_evidence_simulation_id'), table_name='evidence')
    op.drop_index(op.f('ix_evidence_consultation_id'), table_name='evidence')
    op.drop_table('evidence')
