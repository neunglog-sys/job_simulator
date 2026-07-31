"""user documents

Revision ID: f7c2a8d4e901
Revises: b9e1d3a7f206
Create Date: 2026-07-21
"""

import sqlalchemy as sa
from alembic import op

revision = "f7c2a8d4e901"
down_revision = "b9e1d3a7f206"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("original_name", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(op.f("ix_user_documents_user_id"), "user_documents", ["user_id"])
    op.create_index(op.f("ix_user_documents_kind"), "user_documents", ["kind"])


def downgrade() -> None:
    op.drop_index(op.f("ix_user_documents_kind"), table_name="user_documents")
    op.drop_index(op.f("ix_user_documents_user_id"), table_name="user_documents")
    op.drop_table("user_documents")
