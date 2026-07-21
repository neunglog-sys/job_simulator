"""데이터 모델 — docs/architecture/backend-architecture.md §5 기준."""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
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

from app.core.crypto import EncryptedText
from app.core.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class User(TimestampMixin, Base):
    """개인정보(email·name)는 AES-256 암호화 저장, 조회는 email_hash로."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str | None] = mapped_column(EncryptedText)
    email_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    pw_hash: Mapped[str | None] = mapped_column(String(255))  # 소셜 전용 계정은 None
    name: Mapped[str] = mapped_column(EncryptedText)
    terms_agreed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_version: Mapped[str | None] = mapped_column(String(20))
    privacy_agreed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    privacy_version: Mapped[str | None] = mapped_column(String(20))


class UserDocument(TimestampMixin, Base):
    """마이페이지에 보관하는 사용자 소유 PDF 문서.

    원본 파일은 공개 정적 경로가 아닌 STORAGE_DIR 아래에 두고, API에서 소유권을
    확인한 뒤에만 내려준다. 파일명도 개인정보가 포함될 수 있어 암호화한다.
    """

    __tablename__ = "user_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)  # resume | portfolio | other
    original_name: Mapped[str] = mapped_column(EncryptedText)
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    mime_type: Mapped[str] = mapped_column(String(100), default="application/pdf")
    size_bytes: Mapped[int] = mapped_column(Integer)


class OAuthAccount(Base):
    """소셜 로그인 연결 — (provider, provider_user_id)로 사용자를 식별.

    이메일을 주지 않는 provider(카카오 등)나 한 사람이 여러 소셜을 연결하는 경우까지 대응.
    provider_user_id는 provider가 주는 고유 식별자(민감정보 아님, 해시 불필요).
    """

    __tablename__ = "oauth_accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # google | kakao | naver
    provider_user_id: Mapped[str] = mapped_column(String(255))


class Consultation(TimestampMixin, Base):
    """AI 아바타 상담 세션."""

    __tablename__ = "consultations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str | None] = mapped_column(EncryptedText)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|completed
    summary: Mapped[str | None] = mapped_column(EncryptedText)  # Conversation Memory 요약 (암호화)
    survey: Mapped[dict | None] = mapped_column(JSONB)  # 사전 설문 {answers, profile} — 자유대화 전 성향 베이스라인
    # 이력서/포트폴리오 PDF 분석 결과(JSON 문자열, 개인정보라 암호화). 원본 PDF는 저장 안 함.
    resume: Mapped[str | None] = mapped_column(EncryptedText)


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
    role: Mapped[str] = mapped_column(String(64))  # user | assistant | npc
    # role=='npc'일 때 말한 NPC 식별자 (이름 아님 — 길이·표시와 무관하게 안정 참조). 소프트 참조.
    npc_id: Mapped[str | None] = mapped_column(String(64), index=True)
    content: Mapped[str] = mapped_column(EncryptedText)  # 대화 내용 (암호화)


class Job(Base):
    """직무 정의 — data/jobs/*.yaml 시드."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    competencies: Mapped[dict] = mapped_column(JSONB, default=dict)  # 역량 매트릭스
    # RIASEC 흥미유형 중요도(1~5) — 사전 설문(Consultation.survey.profile)과의 매칭용, 없으면 역량 점수만 사용
    interest_profile: Mapped[dict] = mapped_column(JSONB, default=dict)
    # 8모듈 43축 가중치(data/counseling/module_mapping.json에서 이식, 개별 직무 조사 아님) —
    # competencies가 비어있는 시나리오 카테고리 직무(kts-01 등)의 추천 스코어링용 보조 신호
    dimension_weights: Mapped[dict] = mapped_column(JSONB, default=dict)
    # 아래 4개는 배치1 조사 필드(선택) — docs/jobs/batch1_mapping_candidates.md 참고.
    # 미조사 직무는 전부 NULL/빈 리스트.
    education_requirement: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    salary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    certifications: Mapped[list] = mapped_column(JSONB, default=list)
    # provisional|team_review|not_found|cross_check_required — app.content.loader.VALID_JOB_STATUS
    status: Mapped[str | None] = mapped_column(String(30), nullable=True)

    scenarios: Mapped[list["Scenario"]] = relationship(back_populates="job")


class Scenario(Base):
    """시뮬레이션 시나리오 — data/scenarios/*.yaml 시드. 전이 규칙은 steps 안에 내장."""

    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    module: Mapped[str | None] = mapped_column(String(30), index=True)  # 8모듈 — 프론트 배경 선택
    initial_state: Mapped[dict] = mapped_column(JSONB, default=dict)
    steps: Mapped[list] = mapped_column(JSONB, default=list)
    # 돌발 퀘스트 (대표미션) — {npc, intro, task:{prompt, criteria, pass_score}} / 없으면 미발동
    sudden_quest: Mapped[dict | None] = mapped_column(JSONB)

    job: Mapped[Job] = relationship(back_populates="scenarios")
    placements: Mapped[list["NpcPlacement"]] = relationship(back_populates="scenario")


class Npc(Base):
    """NPC 고유정보 (시나리오 무관) — 프롬프트 '재료' 필드만 저장, 완성 프롬프트는 코드가 조립.

    대화 저장/식별은 npc_id로 (이름 길이 무관). 화면 표시는 name + 배치정보(role/rank).
    같은 NPC를 여러 시나리오에서 재사용 가능(placements로 배치).
    """

    __tablename__ = "npcs"

    npc_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 예: npc_jm-01_01
    name: Mapped[str] = mapped_column(String(50))
    personality: Mapped[list] = mapped_column(JSONB, default=list)
    likes: Mapped[list] = mapped_column(JSONB, default=list)
    dislikes: Mapped[list] = mapped_column(JSONB, default=list)
    speech_habits: Mapped[list] = mapped_column(JSONB, default=list)
    # ── 동기화 추적 (YAML=원본, DB=복사본) ──
    source_hash: Mapped[str | None] = mapped_column(String(64))  # YAML 내용 해시 — 안 바뀌면 skip
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # YAML에서 빠지면 삭제 대신 비활성
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    placements: Mapped[list["NpcPlacement"]] = relationship(back_populates="npc")


class NpcPlacement(Base):
    """시나리오별 NPC 배치 — 같은 사람이 시나리오마다 역할·담당업무·등장이 달라질 수 있음."""

    __tablename__ = "npc_placements"
    __table_args__ = (UniqueConstraint("scenario_id", "npc_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id"))
    npc_id: Mapped[str] = mapped_column(ForeignKey("npcs.npc_id"), index=True)
    role: Mapped[str] = mapped_column(String(80))  # 역할 (안전관리자 등)
    rank: Mapped[str | None] = mapped_column(String(50))  # 직급·직책
    responsibilities: Mapped[list] = mapped_column(JSONB, default=list)
    # {location, available_steps:[step_id], conditions:[...]} — 엔진이 등장 판단에 사용, 프롬프트엔 location만
    appearance: Mapped[dict] = mapped_column(JSONB, default=dict)

    scenario: Mapped[Scenario] = relationship(back_populates="placements")
    npc: Mapped[Npc] = relationship(back_populates="placements")


class Recommendation(TimestampMixin, Base):
    __tablename__ = "recommendations"
    # 상담 1건 = 추천 1건. 추천은 "이 상담의 결론"이라 여러 개면 화면마다 다른 답이 나온다
    # (탭 두 개·버튼 연타로 실제로 중복 생성됐다).
    __table_args__ = (UniqueConstraint("consultation_id", name="uq_recommendations_consultation"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    consultation_id: Mapped[int] = mapped_column(ForeignKey("consultations.id"))
    results: Mapped[list] = mapped_column(JSONB, default=list)  # [{job_code, score, reason}]
    feedback: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "helpful" | "not_helpful"


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
    """진로 리포트 — 예선은 상담·추천 기반, 시뮬레이션 합류 시 simulation_id 사용."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    consultation_id: Mapped[int | None] = mapped_column(ForeignKey("consultations.id"))
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|done|failed
    fit_score: Mapped[int | None] = mapped_column(Integer)
    strengths: Mapped[list] = mapped_column(JSONB, default=list)
    improvements: Mapped[list] = mapped_column(JSONB, default=list)
    advice: Mapped[str | None] = mapped_column(Text)
    pdf_path: Mapped[str | None] = mapped_column(String(255))


class Evidence(TimestampMixin, Base):
    """상담·체험 중 수집된 43축 판단 근거 (공통 저장 형식).

    아직 라이브 writer 없음 — LLM 추출 연결 전까지는 그릇만 준비된 상태.
    dimension_code/source_type은 DB FK가 아니라 각각 dimension_definitions.json/
    evidence_rules.json의 키를 참조하는 문자열(데이터팩이 코드보다 자주 바뀌므로).
    """

    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    consultation_id: Mapped[int] = mapped_column(ForeignKey("consultations.id"), index=True)
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id"), index=True)
    stage: Mapped[str] = mapped_column(String(20))  # counseling | experience
    dimension_code: Mapped[str] = mapped_column(String(50), index=True)
    source_type: Mapped[str] = mapped_column(String(30))
    evidence_text: Mapped[str] = mapped_column(Text)
    value: Mapped[str] = mapped_column(String(100))
    confidence: Mapped[int] = mapped_column(Integer)
    confirmed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)
    conflict: Mapped[bool] = mapped_column(Boolean, default=False)


# ─────────────────────────────────────────────────────────────
# 조사자료 원천 테이블 — 팀 조사 엑셀(data/research/*.xlsx) 적재.
# 적재: docker compose exec api python -m app.scripts.load_research
# ─────────────────────────────────────────────────────────────


class KbJob(Base):
    """입문직무 RAG KB v5 · 01_직무마스터 (103개 직무)."""

    __tablename__ = "kb_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_code: Mapped[str] = mapped_column(String(10), unique=True)  # J001
    family_id: Mapped[str] = mapped_column(String(10), index=True)  # F01
    job_group: Mapped[str] = mapped_column(String(100))  # 직무군
    title: Mapped[str] = mapped_column(String(100))  # 세부직무
    module: Mapped[str] = mapped_column(String(30), index=True)  # 8모듈
    priority: Mapped[str | None] = mapped_column(String(30))  # 우선순위(MVP핵심 등)
    in_use: Mapped[str | None] = mapped_column(String(5))  # 사용여부 Y/N
    entry_level: Mapped[str | None] = mapped_column(String(30))  # 입문수준
    interest_type: Mapped[str | None] = mapped_column(String(30))  # 흥미유형(Holland)
    work_targets: Mapped[str | None] = mapped_column(Text)  # 업무대상
    npc_roles: Mapped[str | None] = mapped_column(Text)  # 주요상대 NPC
    outputs: Mapped[str | None] = mapped_column(Text)  # 핵심산출물
    first_scenario: Mapped[str | None] = mapped_column(Text)  # 첫본업 시나리오
    process_flow: Mapped[str | None] = mapped_column(Text)  # 프로세스
    main_mission: Mapped[str | None] = mapped_column(Text)  # 대표미션명
    mission_steps: Mapped[str | None] = mapped_column(Text)  # 미션수행단계
    success_criteria: Mapped[str | None] = mapped_column(Text)
    failure_patterns: Mapped[str | None] = mapped_column(Text)
    grade: Mapped[str | None] = mapped_column(String(5))  # 검증등급
    sources: Mapped[str | None] = mapped_column(Text)  # 근거자료


class KbStage(Base):
    """입문직무 RAG KB v5 · 02_RAG프로세스 (103 job × 5단계 = 515청크).

    벡터 검색용 텍스트는 doc_chunks(source='kb-v5/...')에 별도 임베딩 적재.
    """

    __tablename__ = "kb_stages"
    __table_args__ = (UniqueConstraint("job_code", "stage_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    chunk_code: Mapped[str] = mapped_column(String(15), unique=True)  # J001-S1
    job_code: Mapped[str] = mapped_column(String(10), index=True)
    title: Mapped[str] = mapped_column(String(100))  # 세부직무
    family_id: Mapped[str | None] = mapped_column(String(10))
    job_group: Mapped[str | None] = mapped_column(String(100))
    module: Mapped[str | None] = mapped_column(String(30))
    stage_id: Mapped[str] = mapped_column(String(5))  # S1~S5
    stage_name: Mapped[str | None] = mapped_column(String(100))
    stage_goal: Mapped[str | None] = mapped_column(Text)
    work_targets: Mapped[str | None] = mapped_column(Text)
    npc_roles: Mapped[str | None] = mapped_column(Text)
    outputs: Mapped[str | None] = mapped_column(Text)
    mission_candidate: Mapped[str | None] = mapped_column(Text)
    success_criteria: Mapped[str | None] = mapped_column(Text)
    failure_patterns: Mapped[str | None] = mapped_column(Text)
    grade: Mapped[str | None] = mapped_column(String(5))
    sources: Mapped[str | None] = mapped_column(Text)
    chunk_text: Mapped[str | None] = mapped_column(Text)  # RAG_chunk_text


class CommonProcess(Base):
    """입문직무 RAG KB v5 · 03_공통프로세스 (첫출근 온보딩 공통 단계)."""

    __tablename__ = "common_processes"

    id: Mapped[int] = mapped_column(primary_key=True)
    process_code: Mapped[str] = mapped_column(String(20), unique=True)  # D-3, Day1-01
    division: Mapped[str | None] = mapped_column(String(30))  # 프로세스구분
    section: Mapped[str | None] = mapped_column(String(30))  # 구간
    stage_name: Mapped[str | None] = mapped_column(String(100))
    stage_goal: Mapped[str | None] = mapped_column(Text)
    npc_roles: Mapped[str | None] = mapped_column(Text)
    materials: Mapped[str | None] = mapped_column(Text)  # 확인자료
    outputs: Mapped[str | None] = mapped_column(Text)
    success_criteria: Mapped[str | None] = mapped_column(Text)
    failure_patterns: Mapped[str | None] = mapped_column(Text)
    sources: Mapped[str | None] = mapped_column(Text)


class TeamCategory(Base):
    """팀통합 8모듈 조사 · 01_연결맵 (중분류 40개) — 시트 컬럼 1:1."""

    __tablename__ = "team_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner: Mapped[str | None] = mapped_column(String(20))  # 담당자
    no: Mapped[int | None] = mapped_column(Integer)
    module: Mapped[str] = mapped_column(String(30), index=True)  # 담당모듈
    category: Mapped[str] = mapped_column(String(60), unique=True)  # 프로젝트 중분류
    ledger_rows: Mapped[str | None] = mapped_column(String(20))  # 원장 CSV행수
    ledger_job_kinds: Mapped[str | None] = mapped_column(String(20))  # 원장 세부직종수
    rag_status: Mapped[str | None] = mapped_column(String(10))  # RAG상태
    rag_family: Mapped[str | None] = mapped_column(String(100))
    rag_job_count: Mapped[str | None] = mapped_column(String(10))
    rag_job_ids: Mapped[str | None] = mapped_column(String(100))
    rag_jobs: Mapped[str | None] = mapped_column(Text)  # RAG 세부직무
    work_flow: Mapped[str | None] = mapped_column(Text)  # 공통 업무흐름
    npc_roles: Mapped[str | None] = mapped_column(Text)  # 주요 NPC
    inputs: Mapped[str | None] = mapped_column(Text)  # 입력자료
    outputs: Mapped[str | None] = mapped_column(Text)  # 핵심산출물
    mission_candidates: Mapped[str | None] = mapped_column(Text)  # 미션후보
    sudden_events: Mapped[str | None] = mapped_column(Text)  # 돌발상황
    memo: Mapped[str | None] = mapped_column(Text)  # 연결·보강 메모


class TeamJobEvidence(Base):
    """팀통합 8모듈 조사 · 04_근거_세부직업 — 시트 컬럼 1:1."""

    __tablename__ = "team_job_evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner: Mapped[str | None] = mapped_column(String(20))  # 담당자
    no: Mapped[int | None] = mapped_column(Integer)
    module: Mapped[str | None] = mapped_column(String(30))
    category: Mapped[str] = mapped_column(String(60), unique=True)  # 중분류
    assigned_jobs: Mapped[str | None] = mapped_column(Text)  # 팀 배정 세부직업
    ledger_jobs: Mapped[str | None] = mapped_column(Text)  # 원장 세부직종 목록
    standard_tasks: Mapped[str | None] = mapped_column(Text)  # 대표 표준업무 TOP10
    core_competencies: Mapped[str | None] = mapped_column(Text)  # 핵심직무능력 요약
    evidence_files: Mapped[str | None] = mapped_column(Text)  # 근거 파일
    review_memo: Mapped[str | None] = mapped_column(Text)  # 검수 메모


class TeamStage(Base):
    """팀통합 8모듈 조사 · 02_단계별프로세스 (중분류 × S1~S5 ≈ 200행)."""

    __tablename__ = "team_stages"
    __table_args__ = (UniqueConstraint("category", "stage_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner: Mapped[str | None] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(60), index=True)
    module: Mapped[str | None] = mapped_column(String(30))
    stage_id: Mapped[str] = mapped_column(String(5))  # S1~S5
    stage_name: Mapped[str | None] = mapped_column(String(100))
    stage_goal: Mapped[str | None] = mapped_column(Text)
    materials: Mapped[str | None] = mapped_column(Text)  # 확인자료
    npc_roles: Mapped[str | None] = mapped_column(Text)
    outputs: Mapped[str | None] = mapped_column(Text)
    mission_candidate: Mapped[str | None] = mapped_column(Text)
    success_criteria: Mapped[str | None] = mapped_column(Text)
    failure_patterns: Mapped[str | None] = mapped_column(Text)


class TeamMission(Base):
    """팀통합 8모듈 조사 · 05_상황별미션 (≈200행) — 대표미션은 team_rep_missions 별도."""

    __tablename__ = "team_missions"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner: Mapped[str | None] = mapped_column(String(20))
    mission_code: Mapped[str] = mapped_column(String(20), unique=True)  # KTS-01-01
    module: Mapped[str | None] = mapped_column(String(30), index=True)
    category: Mapped[str] = mapped_column(String(60), index=True)
    situation_type: Mapped[str | None] = mapped_column(String(30))  # 정상업무 등 5유형
    difficulty: Mapped[str | None] = mapped_column(String(10))
    npc: Mapped[str | None] = mapped_column(Text)
    npc_line: Mapped[str | None] = mapped_column(Text)  # NPC 요청 대사
    materials: Mapped[str | None] = mapped_column(Text)  # 제공자료
    mission: Mapped[str | None] = mapped_column(Text)  # 사용자 미션
    action_steps: Mapped[str | None] = mapped_column(Text)  # 필수 행동순서
    outputs: Mapped[str | None] = mapped_column(Text)  # 제출 산출물
    success_criteria: Mapped[str | None] = mapped_column(Text)
    failure_patterns: Mapped[str | None] = mapped_column(Text)
    extra_event: Mapped[str | None] = mapped_column(Text)  # 추가 돌발상황
    rag_link: Mapped[str | None] = mapped_column(String(100))  # RAG 연결
    minutes: Mapped[int | None] = mapped_column(Integer)  # 예상시간(분)
    impl_form: Mapped[str | None] = mapped_column(String(50))  # 구현형태


class TeamRepMission(Base):
    """팀통합 8모듈 조사 · 06_대표미션 — 시트 컬럼 1:1."""

    __tablename__ = "team_rep_missions"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner: Mapped[str | None] = mapped_column(String(20))  # 담당자
    priority: Mapped[str | None] = mapped_column(String(20))  # 우선순위
    mission_code: Mapped[str] = mapped_column(String(20), unique=True)  # mission_id
    module: Mapped[str | None] = mapped_column(String(30))
    category: Mapped[str | None] = mapped_column(String(60), index=True)
    situation: Mapped[str | None] = mapped_column(Text)  # 선정 상황
    npc: Mapped[str | None] = mapped_column(Text)
    core_mission: Mapped[str | None] = mapped_column(Text)  # 핵심 미션
    user_actions: Mapped[str | None] = mapped_column(Text)  # 사용자 선택·행동
    outputs: Mapped[str | None] = mapped_column(Text)  # 산출물
    eval_focus: Mapped[str | None] = mapped_column(Text)  # 평가핵심
    rag_status: Mapped[str | None] = mapped_column(String(100))  # RAG 상태
    reason: Mapped[str | None] = mapped_column(Text)  # 선정 이유


class DocChunk(Base):
    """RAG용 문서 청크 (pgvector) — data/knowledge/<job_code>/*.md 적재."""

    __tablename__ = "doc_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_code: Mapped[str | None] = mapped_column(String(50), index=True)
    source: Mapped[str] = mapped_column(String(255), index=True)  # 원본 파일 상대경로
    file_hash: Mapped[str | None] = mapped_column(String(64))  # 변경 감지용 sha256
    content: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(1536), nullable=True)
