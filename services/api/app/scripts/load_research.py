"""팀 조사 엑셀 → DB 원천 테이블 적재 (내용 무변형, 시트 컬럼 1:1).

대상 파일 (data/research/):
  - 입문직무_RAG_KB_v5_정리본.xlsx      → kb_jobs, kb_stages, common_processes (+doc_chunks 임베딩)
  - 팀통합_8모듈_조사자료_표준화완료.xlsx → team_categories, team_stages, team_missions,
                                          team_job_evidence, team_rep_missions

사용: docker compose exec api python -m app.scripts.load_research
방식: 테이블별 전체 삭제 후 재적재(멱등). 값은 셀 그대로 저장 — 가공·요약 없음.
"""

import asyncio
import hashlib
from pathlib import Path

import openpyxl
from sqlalchemy import Integer, String, Text, delete, text

from app.core.config import settings
from app.llm import get_llm
from app.models import (
    CommonProcess,
    DocChunk,
    KbJob,
    KbStage,
    TeamCategory,
    TeamJobEvidence,
    TeamMission,
    TeamRepMission,
    TeamStage,
)

RESEARCH_DIR = Path(settings.data_dir) / "research"
KB_FILE = "입문직무_RAG_KB_v5_정리본.xlsx"
TEAM_FILE = "팀통합_8모듈_조사자료_표준화완료.xlsx"
EMBED_BATCH = 64

# (시트명, 모델, {시트 헤더: 모델 필드}) — 헤더 1:1 매핑, 여기 없는 헤더는 적재 시 에러
SHEETS = [
    (KB_FILE, "01_직무마스터", KbJob, {
        "job_id": "job_code", "family_id": "family_id", "직무군": "job_group",
        "세부직무": "title", "모듈": "module", "우선순위": "priority",
        "사용여부": "in_use", "입문수준": "entry_level", "흥미유형_매핑후보": "interest_type",
        "업무대상": "work_targets", "주요상대_NPC": "npc_roles", "핵심산출물": "outputs",
        "첫본업_시나리오": "first_scenario", "프로세스": "process_flow",
        "대표미션명": "main_mission", "미션수행단계": "mission_steps",
        "성공기준": "success_criteria", "실패패턴": "failure_patterns",
        "검증등급": "grade", "근거자료": "sources",
    }),
    (KB_FILE, "02_RAG프로세스", KbStage, {
        "chunk_id": "chunk_code", "job_id": "job_code", "세부직무": "title",
        "family_id": "family_id", "직무군": "job_group", "모듈": "module",
        "stage_id": "stage_id", "단계명": "stage_name", "단계목표": "stage_goal",
        "업무대상": "work_targets", "주요상대_NPC": "npc_roles", "핵심산출물": "outputs",
        "미션후보": "mission_candidate", "성공기준": "success_criteria",
        "실패패턴": "failure_patterns", "검증등급": "grade", "근거자료": "sources",
        "RAG_chunk_text": "chunk_text",
    }),
    (KB_FILE, "03_공통프로세스", CommonProcess, {
        "process_id": "process_code", "프로세스구분": "division", "구간": "section",
        "단계명": "stage_name", "단계목표": "stage_goal", "NPC": "npc_roles",
        "확인자료": "materials", "산출물": "outputs", "성공기준": "success_criteria",
        "실패패턴": "failure_patterns", "근거": "sources",
    }),
    (TEAM_FILE, "01_연결맵", TeamCategory, {
        "담당자": "owner", "No": "no", "담당모듈": "module", "프로젝트 중분류": "category",
        "원장 CSV행수": "ledger_rows", "원장 세부직종수": "ledger_job_kinds",
        "RAG상태": "rag_status", "RAG family": "rag_family", "RAG job 수": "rag_job_count",
        "RAG job_id": "rag_job_ids", "RAG 세부직무": "rag_jobs",
        "공통 업무흐름": "work_flow", "주요 NPC": "npc_roles", "입력자료": "inputs",
        "핵심산출물": "outputs", "미션후보": "mission_candidates",
        "돌발상황": "sudden_events", "연결·보강 메모": "memo",
    }),
    (TEAM_FILE, "02_단계별프로세스", TeamStage, {
        "담당자": "owner", "중분류": "category", "모듈": "module", "stage_id": "stage_id",
        "단계명": "stage_name", "단계목표": "stage_goal", "확인자료": "materials",
        "주요 NPC": "npc_roles", "핵심산출물": "outputs", "미션후보": "mission_candidate",
        "성공기준": "success_criteria", "실패패턴": "failure_patterns",
    }),
    (TEAM_FILE, "04_근거_세부직업", TeamJobEvidence, {
        "담당자": "owner", "No": "no", "모듈": "module", "중분류": "category",
        "팀 배정 세부직업": "assigned_jobs", "원장 세부직종 목록": "ledger_jobs",
        "대표 표준업무 TOP10": "standard_tasks", "핵심직무능력 요약": "core_competencies",
        "근거 파일": "evidence_files", "검수 메모": "review_memo",
    }),
    (TEAM_FILE, "05_상황별미션", TeamMission, {
        "담당자": "owner", "mission_id": "mission_code", "모듈": "module",
        "중분류": "category", "상황유형": "situation_type", "난이도": "difficulty",
        "NPC": "npc", "NPC 요청 대사": "npc_line", "제공자료": "materials",
        "사용자 미션": "mission", "필수 행동순서": "action_steps",
        "제출 산출물": "outputs", "성공기준": "success_criteria",
        "실패패턴": "failure_patterns", "추가 돌발상황": "extra_event",
        "RAG 연결": "rag_link", "예상시간(분)": "minutes", "구현형태": "impl_form",
    }),
    (TEAM_FILE, "06_대표미션", TeamRepMission, {
        "담당자": "owner", "우선순위": "priority", "mission_id": "mission_code",
        "모듈": "module", "중분류": "category", "선정 상황": "situation",
        "NPC": "npc", "핵심 미션": "core_mission", "사용자 선택·행동": "user_actions",
        "산출물": "outputs", "평가핵심": "eval_focus", "RAG 상태": "rag_status",
        "선정 이유": "reason",
    }),
]


def read_sheet(path: Path, sheet: str, mapping: dict) -> list[dict]:
    """헤더 행을 찾아 매핑대로 dict 목록 반환 — 셀 값 무변형."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    first_header = next(iter(mapping))
    header_idx = None
    records = []
    for row in ws.iter_rows(values_only=True):
        if header_idx is None:
            if row and row[0] == first_header:
                header_idx = {h: i for i, h in enumerate(row) if h is not None}
                missing = set(mapping) - set(header_idx)
                if missing:
                    raise ValueError(f"{sheet}: 시트에 없는 헤더 {missing}")
            continue
        if not row or all(v is None for v in row):
            continue
        key_cell = row[header_idx[first_header]]
        if key_cell is None:
            continue
        records.append({field: row[header_idx[h]] for h, field in mapping.items()})
    wb.close()
    if header_idx is None:
        raise ValueError(f"{sheet}: 헤더 행({first_header})을 찾지 못함")
    return records


def _coerce(model, rec: dict, context: str) -> dict:
    """엑셀 셀 타입과 DB 컬럼 타입 정합 — 값 보존, 비정합은 행 위치와 함께 즉시 에러.

    - 문자열 컬럼 + 숫자 셀: 문자로 ("100"). '원장 CSV행수'처럼 숫자/'-' 혼합 컬럼 대응
    - 정수 컬럼 + 9.0 같은 정수형 float: int로
    - 정수 컬럼 + '미정'/'10~15' 같은 문자: 어느 시트 어느 행인지 명시하고 실패
      (asyncpg의 위치 불명 에러 대신 — 조사 시트는 팀이 계속 편집하므로)
    """
    out = {}
    for field, value in rec.items():
        col = model.__table__.columns[field]
        if value is not None:
            if isinstance(col.type, (String, Text)) and not isinstance(value, str):
                if isinstance(value, float) and value.is_integer():
                    value = str(int(value))  # 9.0 → "9"
                else:
                    value = str(value)
            elif isinstance(col.type, Integer):
                if isinstance(value, float) and value.is_integer():
                    value = int(value)
                elif not isinstance(value, int):
                    raise ValueError(
                        f"{context}: '{field}' 컬럼은 정수여야 하는데 {value!r} — 엑셀 셀 확인 필요"
                    )
        out[field] = value
    return out


async def load_tables(session) -> dict[str, int]:
    counts = {}
    for filename, sheet, model, mapping in SHEETS:
        path = RESEARCH_DIR / filename
        records = read_sheet(path, sheet, mapping)
        await session.execute(delete(model))  # 전체 재적재(멱등)
        for i, rec in enumerate(records, 1):
            session.add(model(**_coerce(model, rec, f"{sheet} {i}번째 행")))
        counts[f"{model.__tablename__} ({sheet})"] = len(records)
    await session.commit()
    return counts


async def embed_kb_chunks(session) -> int:
    """kb_stages.chunk_text → doc_chunks 벡터 적재 (source='kb-v5/<chunk_code>').

    provider+내용 해시(file_hash)로 변경을 감지해 동일하면 재임베딩을 건너뛴다(비용 절약).
    임베더가 mock이면 실벡터를 무작위값으로 덮어써 RAG가 조용히 죽으므로 적재를 거부한다.
    """
    provider = get_llm().embedder.name
    if provider == "mock":
        print("  ⚠ 임베더가 mock — KB 재적재 건너뜀(실벡터 오염 방지). 실 Gemini 키로 다시 실행하세요.")
        return 0

    rows = (
        await session.execute(
            text("SELECT chunk_code, job_code, chunk_text FROM kb_stages "
                 "WHERE chunk_text IS NOT NULL AND length(trim(chunk_text)) > 0 "
                 "ORDER BY id")  # 빈 문자열은 임베딩 API가 거부하므로 제외
        )
    ).all()
    # provider + 전체 청크 내용 시그니처 — 내용/프로바이더가 하나라도 바뀌면 재적재
    sig = hashlib.sha256((provider + "\n".join(r[2] for r in rows)).encode()).hexdigest()
    existing = (
        await session.execute(
            text("SELECT DISTINCT file_hash FROM doc_chunks WHERE source LIKE 'kb-v5/%'")
        )
    ).scalars().all()
    if existing == [sig]:
        print(f"  KB v5 변경 없음(provider+내용 동일) — 재임베딩 스킵 ({len(rows)}청크 유지)")
        return len(rows)

    await session.execute(delete(DocChunk).where(DocChunk.source.like("kb-v5/%")))
    llm = get_llm()
    for i in range(0, len(rows), EMBED_BATCH):
        batch = rows[i : i + EMBED_BATCH]
        vectors = await llm.embed([r[2] for r in batch])
        for (chunk_code, job_code, chunk_text), vector in zip(batch, vectors, strict=True):
            session.add(DocChunk(
                job_code=job_code,
                source=f"kb-v5/{chunk_code}",
                file_hash=sig,
                content=chunk_text,
                embedding=vector,
            ))
    await session.commit()
    return len(rows)


async def main() -> None:
    from app.core.db import SessionFactory

    async with SessionFactory() as session:
        counts = await load_tables(session)
        for name, n in counts.items():
            print(f"  {name}: {n}건")
        n = await embed_kb_chunks(session)
        print(f"  doc_chunks (kb-v5 임베딩): {n}건")
    print("적재 완료")


if __name__ == "__main__":
    asyncio.run(main())
