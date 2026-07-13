"""merge npc_normalize and job_survey_fields

Revision ID: c32d61e63ba4
Revises: b2c3d4e5f6a7, e4b7d2a91c5f
Create Date: 2026-07-13 13:57:57.832637

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision: str = 'c32d61e63ba4'
down_revision: Union[str, None] = ('b2c3d4e5f6a7', 'e4b7d2a91c5f')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
