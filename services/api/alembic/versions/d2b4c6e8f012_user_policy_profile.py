"""user policy profile columns

맞춤 제도 추천에 쓸 프로필(생년·성별·거주지·장애여부). 전부 nullable —
기존 사용자는 값이 없고, 그 경우 해당 조건 없이 넓게 검색한다.

장애여부는 민감정보라 암호화 컬럼(EncryptedText = Text)에 담고 별도 동의 시각을 함께 둔다.

Revision ID: d2b4c6e8f012
Revises: c1a2b3d4e5f6
Create Date: 2026-07-23 18:40:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d2b4c6e8f012"
down_revision: Union[str, None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = {
    "birth_year": sa.Column("birth_year", sa.Integer(), nullable=True),
    "gender": sa.Column("gender", sa.String(length=10), nullable=True),
    "region_ctpv": sa.Column("region_ctpv", sa.String(length=30), nullable=True),
    "region_sgg": sa.Column("region_sgg", sa.String(length=30), nullable=True),
    "has_disability_enc": sa.Column("has_disability_enc", sa.Text(), nullable=True),
    "sensitive_agreed_at": sa.Column(
        "sensitive_agreed_at", sa.DateTime(timezone=True), nullable=True
    ),
}


def upgrade() -> None:
    # 멱등: 이미 있는 컬럼은 건너뛴다 (로컬에서 먼저 추가된 경우 등).
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("users", column)


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("users", name)
