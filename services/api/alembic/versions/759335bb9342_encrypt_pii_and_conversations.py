"""encrypt pii and conversations

Revision ID: 759335bb9342
Revises: 16dcc6e97d3d
Create Date: 2026-07-09 07:07:07.967292

개인정보(email·name)·상담 대화(content)·상담 요약(summary)을 AES-256-GCM으로 암호화.
스키마 변경 + 기존 평문 데이터 백필(enc:v1: 접두사 없는 행만 암호화).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.crypto import email_hash, encrypt_str

revision: str = '759335bb9342'
down_revision: Union[str, None] = '16dcc6e97d3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PREFIX = "enc:v1:"


def upgrade() -> None:
    # --- 스키마 (EncryptedText는 DB 관점에선 TEXT) ---
    op.add_column('users', sa.Column('email_hash', sa.String(length=64), nullable=True))
    op.alter_column('users', 'email', existing_type=sa.VARCHAR(length=255),
                    type_=sa.Text(), existing_nullable=True)
    op.alter_column('users', 'name', existing_type=sa.VARCHAR(length=100),
                    type_=sa.Text(), existing_nullable=False)
    op.drop_constraint(op.f('users_email_key'), 'users', type_='unique')
    op.create_unique_constraint('uq_users_email_hash', 'users', ['email_hash'])

    # --- 기존 평문 데이터 백필 ---
    conn = op.get_bind()

    for uid, email, name in conn.execute(
        sa.text("SELECT id, email, name FROM users")
    ).fetchall():
        params = {"id": uid}
        sets = []
        if email and not email.startswith(_PREFIX):
            sets += ["email = :email", "email_hash = :ehash"]
            params |= {"email": encrypt_str(email), "ehash": email_hash(email)}
        if name and not name.startswith(_PREFIX):
            sets.append("name = :name")
            params["name"] = encrypt_str(name)
        if sets:
            conn.execute(sa.text(f"UPDATE users SET {', '.join(sets)} WHERE id = :id"), params)

    for mid, content in conn.execute(
        sa.text(f"SELECT id, content FROM messages WHERE content NOT LIKE '{_PREFIX}%'")
    ).fetchall():
        conn.execute(
            sa.text("UPDATE messages SET content = :c WHERE id = :id"),
            {"c": encrypt_str(content), "id": mid},
        )

    for cid, summary in conn.execute(
        sa.text(
            f"SELECT id, summary FROM consultations "
            f"WHERE summary IS NOT NULL AND summary NOT LIKE '{_PREFIX}%'"
        )
    ).fetchall():
        conn.execute(
            sa.text("UPDATE consultations SET summary = :s WHERE id = :id"),
            {"s": encrypt_str(summary), "id": cid},
        )


def downgrade() -> None:
    # 암호문 복호화 백필은 지원하지 않음 (스키마만 되돌림)
    op.drop_constraint('uq_users_email_hash', 'users', type_='unique')
    op.create_unique_constraint(op.f('users_email_key'), 'users', ['email'])
    op.alter_column('users', 'name', existing_type=sa.Text(),
                    type_=sa.VARCHAR(length=100), existing_nullable=False)
    op.alter_column('users', 'email', existing_type=sa.Text(),
                    type_=sa.VARCHAR(length=255), existing_nullable=True)
    op.drop_column('users', 'email_hash')
