"""consultation/resume — 이력서 PDF 추출·분석·업로드(PDF만)."""

import io
import json

import pytest
from fastapi import HTTPException
from reportlab.pdfgen import canvas

from app.domains.consultation import resume


def _make_pdf(text: str) -> bytes:
    """테스트용 텍스트 PDF 생성 (reportlab)."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(text.split("\n")):
        c.drawString(72, 800 - i * 20, line)
    c.save()
    return buf.getvalue()


def test_extract_text_from_pdf():
    # reportlab 기본 폰트엔 한글 글리프가 없어(테스트 한정) 라틴 텍스트로 추출을 검증한다.
    # 실제 사용자 PDF는 폰트가 임베드돼 한글도 정상 추출된다.
    pdf = _make_pdf("Backend Developer\nPython FastAPI experience\nPortfolio 3 projects")
    text = resume.extract_text(pdf)
    assert "FastAPI" in text and "Portfolio" in text


def test_extract_text_rejects_non_pdf():
    with pytest.raises(HTTPException) as exc:
        resume.extract_text(b"this is not a pdf")
    assert exc.value.status_code == 400


def test_extract_text_rejects_empty_text_pdf():
    empty = _make_pdf("")  # 텍스트 없는 PDF (스캔본 시뮬레이션)
    with pytest.raises(HTTPException) as exc:
        resume.extract_text(empty)
    assert exc.value.status_code == 400


def test_extract_text_truncates_to_limit():
    huge = _make_pdf("가" * 20_000)
    assert len(resume.extract_text(huge)) <= resume.MAX_TEXT_CHARS


def test_load_analysis_roundtrip():
    class _C:
        resume = json.dumps({"summary": "요약", "skills": ["a"]}, ensure_ascii=False)

    assert resume.load_analysis(_C())["summary"] == "요약"


def test_load_analysis_none_and_corrupt():
    class _Empty:
        resume = None

    class _Bad:
        resume = "not-json{"

    assert resume.load_analysis(_Empty()) is None
    assert resume.load_analysis(_Bad()) is None


def test_extract_text_accepts_empty_password_encrypted_pdf():
    # 소유자 암호만 걸고 사용자 암호는 빈 PDF(흔함) → 빈 암호 복호화로 읽혀야 한다(반려 금지).
    from reportlab.lib import pdfencrypt

    enc = pdfencrypt.StandardEncryption("", ownerPassword="owner")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, encrypt=enc)
    c.drawString(72, 800, "Encrypted Resume FastAPI")
    c.save()
    text = resume.extract_text(buf.getvalue())
    assert "FastAPI" in text


@pytest.mark.asyncio(loop_scope="session")
async def test_analyze_returns_structured():
    result = await resume.analyze("백엔드 개발자, Python 경험")
    for key in ("summary", "skills", "experiences", "strengths", "desired_directions", "opening_question"):
        assert key in result


@pytest.mark.asyncio(loop_scope="session")
async def test_upload_endpoint_rejects_non_pdf(client):
    created = await client.post("/api/consultations")
    cid = created.json()["id"]
    res = await client.post(
        f"/api/consultations/{cid}/resume",
        files={"file": ("resume.txt", b"plain text", "text/plain")},
    )
    assert res.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_upload_endpoint_rejects_oversized(client, monkeypatch):
    # 상한을 낮춰 대용량 방어 경로(413)를 검증 — 실제 8MB 할당 없이.
    monkeypatch.setattr(resume, "MAX_PDF_BYTES", 10)
    created = await client.post("/api/consultations")
    cid = created.json()["id"]
    res = await client.post(
        f"/api/consultations/{cid}/resume",
        files={"file": ("resume.pdf", b"%PDF-1.4 padding beyond limit", "application/pdf")},
    )
    assert res.status_code == 413


@pytest.mark.asyncio(loop_scope="session")
async def test_upload_endpoint_accepts_pdf_and_persists(client, db_session):
    from app.models import Consultation

    created = await client.post("/api/consultations")
    cid = created.json()["id"]
    pdf = _make_pdf("데이터 분석가 지원\nSQL 파이썬 대시보드 경험")
    res = await client.post(
        f"/api/consultations/{cid}/resume",
        files={"file": ("resume.pdf", pdf, "application/pdf")},
    )
    assert res.status_code == 200
    assert "opening_question" in res.json()
    # DB에 분석 결과 저장됐는지
    consultation = await db_session.get(Consultation, cid)
    assert consultation.resume and json.loads(consultation.resume)
