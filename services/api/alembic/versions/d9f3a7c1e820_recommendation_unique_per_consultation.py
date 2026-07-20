"""상담 1건당 추천 1건 — 중복 정리 후 유니크 제약

추천은 "이 상담의 결론"이라 여러 개면 화면마다 다른 답이 나온다. 실제로 탭 두 개나
버튼 연타로 중복 생성되고 있었고, LLM 프로필 추출이 매번 달라 결과까지 달라졌다.
기존 중복은 가장 최근 것만 남기고 정리한 뒤 제약을 건다.

Revision ID: d9f3a7c1e820
Revises: c8d4e6f7a1b2
"""

from alembic import op

revision = "d9f3a7c1e820"
down_revision = "c8d4e6f7a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 같은 상담에 여러 건이면 최신 1건만 남긴다 (오래된 것은 이미 화면에서 안 쓰던 값)
    op.execute(
        """
        DELETE FROM recommendations r
        USING recommendations newer
        WHERE r.consultation_id = newer.consultation_id
          AND r.id < newer.id
        """
    )
    op.create_unique_constraint(
        "uq_recommendations_consultation", "recommendations", ["consultation_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_recommendations_consultation", "recommendations", type_="unique")
