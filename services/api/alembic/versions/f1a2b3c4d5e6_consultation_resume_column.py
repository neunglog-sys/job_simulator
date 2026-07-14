"""consultation resume column (이력서/포트폴리오 분석 결과)

Revision ID: f1a2b3c4d5e6
Revises: d5e6f7a8b9c0
Create Date: 2026-07-14 15:10:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 이력서 분석 결과(암호화 JSON 문자열). nullable — 업로드 안 해도 상담 진행 (하위호환).
    op.add_column("consultations", sa.Column("resume", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("consultations", "resume")
