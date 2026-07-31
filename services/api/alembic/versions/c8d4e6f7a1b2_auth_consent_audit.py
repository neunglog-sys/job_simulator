"""회원가입 필수 약관 동의 시각과 문서 버전 저장

Revision ID: c8d4e6f7a1b2
Revises: b7e4c2a1f9d0
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op

revision = "c8d4e6f7a1b2"
down_revision = "b7e4c2a1f9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_agreed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("terms_version", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("privacy_agreed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("privacy_version", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "privacy_version")
    op.drop_column("users", "privacy_agreed_at")
    op.drop_column("users", "terms_version")
    op.drop_column("users", "terms_agreed_at")
