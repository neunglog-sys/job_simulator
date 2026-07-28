"""이력서/포트폴리오(PDF) 분석 — 텍스트 추출(pypdf) → LLM 구조화.

흐름: 사전 설문 → 이력서 업로드 → 상담사가 자유대화 초반에 이력·설문을 근거로
'희망 직무 방향'을 한 번 확인 → 그 대화가 추천으로 이어진다.
이력은 추천 점수에 직접 꽂지 않고, 상담사가 대화에서 짚어주는 재료로 쓴다.

원본 PDF는 저장하지 않고 분석 결과(JSON)만 Consultation.resume(암호화)에 남긴다.
"""

import io
import json
import logging
from pathlib import Path

from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, User, UserDocument

logger = logging.getLogger(__name__)

MAX_PDF_BYTES = 8 * 1024 * 1024  # 8MB — 이력서/포트폴리오엔 충분, 남용 방지
MAX_TEXT_CHARS = 12_000  # LLM에 넣는 추출 텍스트 상한 (프롬프트 폭주 방지)

_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "experiences": {"type": "array", "items": {"type": "string"}},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "desired_directions": {"type": "array", "items": {"type": "string"}},
        "opening_question": {"type": "string"},
    },
    "required": [
        "summary",
        "skills",
        "experiences",
        "strengths",
        "desired_directions",
        "opening_question",
    ],
    "additionalProperties": False,
}


def extract_text(data: bytes) -> str:
    """PDF 바이트 → 텍스트. 파싱 불가·진짜 잠긴 PDF는 400."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # 소유자 암호만 걸고 사용자 암호는 빈 문자열인 PDF(워드·macOS 내보내기 등)는
            # 흔하고 실제로 열린다 → 빈 암호 복호화를 먼저 시도, 그래도 안 되면 거부.
            if not reader.decrypt(""):
                raise HTTPException(
                    status_code=400,
                    detail="암호가 걸린 PDF는 분석할 수 없어요. 암호를 풀고 올려주세요.",
                )
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — 손상 PDF 등은 사용자 오류(400)로 처리
        logger.warning("PDF 파싱 실패: %s", exc)
        raise HTTPException(status_code=400, detail="PDF를 읽을 수 없어요. 파일을 확인해주세요.")

    text = text.strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="PDF에서 텍스트를 찾지 못했어요(이미지 스캔본일 수 있어요). 텍스트 PDF로 올려주세요.",
        )
    return text[:MAX_TEXT_CHARS]


async def analyze(text: str) -> dict:
    """추출 텍스트 → 구조화 분석(스킬·경험·강점·추정 희망직무 + 상담사 확인질문)."""
    system = render_prompt("consultation/resume_extract.md")
    return await get_llm().chat_json(
        [ChatMessage(role="user", content=f"## 이력서/포트폴리오 텍스트\n{text}")],
        system=system,
        json_schema=_ANALYSIS_SCHEMA,
    )


async def attach_resume(
    session: AsyncSession, consultation: Consultation, data: bytes
) -> dict:
    """PDF 바이트 → 추출 → 분석 → consultation에 저장 → 분석 결과 반환.

    크기 상한은 호출부(라우터)에서 읽기 상한으로 강제한다.
    상담사(아바타)가 이후 대화에서 이 분석을 근거로 희망 직무 방향을 확인한다.
    """
    text = extract_text(data)
    try:
        analysis = await analyze(text)
    except Exception:  # noqa: BLE001 — LLM 흔들림(실키·파싱)은 확정 5xx 대신 구조화 에러로
        logger.exception("이력서 분석 LLM 실패 (consultation=%d)", consultation.id)
        raise HTTPException(
            status_code=503, detail="이력서 분석에 실패했어요. 잠시 후 다시 시도해주세요."
        )
    consultation.resume = json.dumps(analysis, ensure_ascii=False)  # 스칼라 대입 → 변경 자동 감지
    await session.commit()
    return analysis


def load_analysis(consultation: Consultation) -> dict | None:
    """저장된 이력 분석(JSON) 복원 — 없거나 깨졌으면 None (상담은 계속 진행)."""
    if not consultation.resume:
        return None
    try:
        return json.loads(consultation.resume)
    except (ValueError, TypeError):
        return None


async def _latest_stored_resume(
    session: AsyncSession, user: User
) -> UserDocument | None:
    """마이페이지에 저장된 이력서(kind=resume) 중 가장 최근 것 — 없으면 None."""
    return (
        (
            await session.execute(
                select(UserDocument)
                .where(
                    UserDocument.user_id == user.id,
                    UserDocument.kind == "resume",
                )
                .order_by(
                    UserDocument.created_at.desc(), UserDocument.id.desc()
                )
            )
        )
        .scalars()
        .first()
    )


async def attach_resume_from_storage(
    session: AsyncSession, consultation: Consultation, user: User
) -> dict | None:
    """마이페이지 보관함에 저장된 이력서(kind=resume)를 상담에 자동 연결한다(B안).

    상담 시작 시 호출한다. 흐름:
      - 이미 분석돼 있으면(consultation.resume) 재분석 없이 기존 결과 반환(멱등 — 새로고침·재진입 안전).
      - 저장된 이력서가 없으면 None (상담은 그대로 진행 — 이력서는 선택).
      - 파일이 사라졌거나 분석(파싱/LLM)이 실패해도 None으로 조용히 넘긴다.
        자동 트리거라 사용자가 명시적으로 올린 게 아니므로, 실패가 상담 시작을 깨선 안 된다.
    """
    existing = load_analysis(consultation)
    if existing is not None:
        return existing

    document = await _latest_stored_resume(session, user)
    if document is None:
        return None

    path = Path(settings.storage_dir) / document.storage_key
    try:
        data = path.read_bytes()
    except OSError:
        logger.warning(
            "저장된 이력서 파일을 읽지 못함(자동연결 건너뜀): %s", path
        )
        return None

    try:
        return await attach_resume(session, consultation, data)
    except HTTPException as exc:
        # 손상 PDF(400)·LLM 흔들림(503) 등 — 자동연결이라 상담을 막지 않고 조용히 생략.
        logger.info(
            "저장 이력서 자동 분석 건너뜀(%s): consultation=%d",
            exc.detail,
            consultation.id,
        )
        return None
