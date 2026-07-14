"""이력서/포트폴리오(PDF) 분석 — 텍스트 추출(pypdf) → LLM 구조화.

흐름: 사전 설문 → 이력서 업로드 → 상담사가 자유대화 초반에 이력·설문을 근거로
'희망 직무 방향'을 한 번 확인 → 그 대화가 추천으로 이어진다.
이력은 추천 점수에 직접 꽂지 않고, 상담사가 대화에서 짚어주는 재료로 쓴다.

원본 PDF는 저장하지 않고 분석 결과(JSON)만 Consultation.resume(암호화)에 남긴다.
"""

import json
import logging

from fastapi import HTTPException
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation

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
    """PDF 바이트 → 텍스트. 파싱 불가·암호화 PDF는 400."""
    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise HTTPException(status_code=400, detail="암호가 걸린 PDF는 분석할 수 없어요.")
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except HTTPException:
        raise
    except (PdfReadError, Exception) as exc:  # noqa: BLE001 — 손상 PDF 등은 사용자 오류로 처리
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
    """PDF 업로드 처리: 추출 → 분석 → consultation에 저장 → 분석 결과 반환.

    상담사(아바타)가 이후 대화에서 이 분석을 근거로 희망 직무 방향을 확인한다.
    """
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 커요(최대 8MB).")
    text = extract_text(data)
    analysis = await analyze(text)
    consultation.resume = json.dumps(analysis, ensure_ascii=False)
    flag_modified(consultation, "resume")
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
