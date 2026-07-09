"""데이터 모델 — docs/architecture/backend-architecture.md §5 기준."""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    pw_hash: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(100))


class Consultation(TimestampMixin, Base):
    """AI 아바타 상담 세션."""

    __tablename__ = "consultations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|completed
    summary: Mapped[str | None] = mapped_column(Text)  # Conversation Memory 요약


class Message(TimestampMixin, Base):
    """상담/시뮬레이션 공용 대화 로그."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    consultation_id: Mapped[int | None] = mapped_column(
        ForeignKey("consultations.id"), index=True
    )
    simulation_id: Mapped[int | None] = mapped_column(
        ForeignKey("simulations.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # user|assistant|npc:{name}
    content: Mapped[str] = mapped_column(Text)


class Job(Base):
    """직무 정의 — data/jobs/*.yaml 시드."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    competencies: Mapped[dict] = mapped_column(JSONB, default=dict)  # 역량 매트릭스

    scenarios: Mapped[list["Scenario"]] = relationship(back_populates="job")


class Scenario(Base):
    """시뮬레이션 시나리오 — data/scenarios/*.yaml 시드. 전이 규칙은 steps 안에 내장."""

    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    initial_state: Mapped[dict] = mapped_column(JSONB, default=dict)
    steps: Mapped[list] = mapped_column(JSONB, default=list)

    job: Mapped[Job] = relationship(back_populates="scenarios")
    npc_personas: Mapped[list["NpcPersona"]] = relationship(back_populates="scenario")


class NpcPersona(Base):
    __tablename__ = "npc_personas"
    __table_args__ = (UniqueConstraint("scenario_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id"))
    name: Mapped[str] = mapped_column(String(50))
    rank: Mapped[str] = mapped_column(String(50))  # 직급
    personality: Mapped[str] = mapped_column(Text)
    system_prompt: Mapped[str] = mapped_column(Text)

    scenario: Mapped[Scenario] = relationship(back_populates="npc_personas")


class Recommendation(TimestampMixin, Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    consultation_id: Mapped[int] = mapped_column(ForeignKey("consultations.id"))
    results: Mapped[list] = mapped_column(JSONB, default=list)  # [{job_code, score, reason}]


class Simulation(TimestampMixin, Base):
    __tablename__ = "simulations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|completed|aborted
    # {step, trust, schedule_stability, requirement_clarity, ...} 스냅샷
    state: Mapped[dict] = mapped_column(JSONB, default=dict)


class ActionLog(TimestampMixin, Base):
    """시뮬레이션 중 사용자 행동 로그 — 스코어링·리포트의 원천 데이터."""

    __tablename__ = "action_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    simulation_id: Mapped[int] = mapped_column(ForeignKey("simulations.id"), index=True)
    type: Mapped[str] = mapped_column(String(30))  # chat|choice|task_submit|step_clear
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    state_delta: Mapped[dict] = mapped_column(JSONB, default=dict)


class Report(TimestampMixin, Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    simulation_id: Mapped[int] = mapped_column(ForeignKey("simulations.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|done|failed
    fit_score: Mapped[int | None] = mapped_column(Integer)
    strengths: Mapped[list] = mapped_column(JSONB, default=list)
    improvements: Mapped[list] = mapped_column(JSONB, default=list)
    advice: Mapped[str | None] = mapped_column(Text)
    pdf_path: Mapped[str | None] = mapped_column(String(255))


class DocChunk(Base):
    """RAG용 문서 청크 (pgvector)."""

    __tablename__ = "doc_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(1536), nullable=True)
