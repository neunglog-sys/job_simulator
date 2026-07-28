"""이력서 자동연결(B안) — 마이페이지 보관함의 이력서(kind=resume)를 상담 시작 시 자동 분석·연결.

흐름: 사용자가 마이페이지에 이력서 PDF를 저장(/api/profile/documents, kind=resume) → 상담 시작 시
프론트가 POST /api/consultations/{id}/resume/from-storage 호출 → 저장된 이력서를 읽어 분석하고
Consultation.resume에 저장 → 이후 자유대화에서 상담사(아바타)가 이력을 근거로 방향을 짚는다.

핵심 불변식(실패 경로 강제):
  - 저장된 이력서가 없으면 조용히 no-op (attached=false), 상담은 그대로 진행.
  - 이미 분석돼 있으면 재분석 없이 기존 결과 반환(멱등) — 새로고침/재진입이 LLM을 다시 때리지 않음.
  - 손상 PDF·파일 유실·LLM 실패는 전부 삼켜 attached=false — 자동 트리거가 상담 시작을 깨선 안 됨.
  - kind=resume만 대상 — portfolio/other는 자동연결하지 않음.
"""

import io
import json

import pytest
from reportlab.pdfgen import canvas

from app.core.config import settings
from app.domains.consultation import resume
from app.models import Consultation, User, UserDocument

# reportlab 기본 폰트엔 한글 글리프가 없어(테스트 한정) 라틴 텍스트로 추출을 검증한다.
MINIMAL_TEXT_PDF_TEXT = "Data Analyst\nSQL Python dashboard experience\nPortfolio 3 projects"
# %PDF- 서명은 통과하지만 pypdf가 텍스트를 못 뽑는 껍데기 PDF(업로드는 되나 분석은 실패).
BROKEN_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"

_FAKE_ANALYSIS = {
    "summary": "데이터 분석 지향 지원자",
    "skills": ["SQL", "Python"],
    "experiences": ["대시보드 구축"],
    "strengths": ["수치 해석"],
    "desired_directions": ["데이터 분석가"],
    "opening_question": "데이터 분석 쪽으로 더 파고들고 싶으신가요?",
}


def _make_pdf(text: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(text.split("\n")):
        c.drawString(72, 800 - i * 20, line)
    c.save()
    return buf.getvalue()


async def _make_user(db_session, email: str) -> User:
    user = User(email=email, email_hash=f"resume-ac:{email}", name=email)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _upload_document(client, user_id: int, data: bytes, kind: str) -> int:
    resp = await client.post(
        "/api/profile/documents",
        headers={"X-User-Id": str(user_id)},
        data={"kind": kind},
        files={"file": ("doc.pdf", data, "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _create_consultation(client, user_id: int) -> int:
    resp = await client.post("/api/consultations", headers={"X-User-Id": str(user_id)})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _stub_analyze(monkeypatch):
    """LLM 호출을 결정론 스텁으로 대체 — 자동연결 배선만 검증(분석 품질은 test_resume.py 담당)."""

    async def _fake(_text: str) -> dict:
        return dict(_FAKE_ANALYSIS)

    monkeypatch.setattr(resume, "analyze", _fake)


# ── 정상 경로: 저장된 이력서를 상담에 자동 연결하고 DB에 남긴다 ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_analyzes_and_persists(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    _stub_analyze(monkeypatch)
    user = await _make_user(db_session, "attach@resume")
    await _upload_document(client, user.id, _make_pdf(MINIMAL_TEXT_PDF_TEXT), "resume")
    cid = await _create_consultation(client, user.id)

    res = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["attached"] is True
    assert body["analysis"]["opening_question"] == _FAKE_ANALYSIS["opening_question"]

    # DB에 분석 결과가 실제로 저장돼야 stream_reply가 프롬프트에 주입할 수 있다.
    consultation = await db_session.get(Consultation, cid)
    assert consultation.resume and json.loads(consultation.resume)["summary"]


# ── no-op: 저장된 이력서가 없으면 조용히 넘어가고 상담은 깨지지 않는다 ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_noop_without_stored_resume(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    _stub_analyze(monkeypatch)
    user = await _make_user(db_session, "noresume@resume")
    cid = await _create_consultation(client, user.id)

    res = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"attached": False, "analysis": None}
    consultation = await db_session.get(Consultation, cid)
    assert consultation.resume is None


# ── kind 격리: 이력서가 아닌 문서(portfolio)는 자동연결 대상이 아니다 ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_ignores_non_resume_kind(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    _stub_analyze(monkeypatch)
    user = await _make_user(db_session, "portfolio@resume")
    await _upload_document(client, user.id, _make_pdf(MINIMAL_TEXT_PDF_TEXT), "portfolio")
    cid = await _create_consultation(client, user.id)

    res = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["attached"] is False


# ── 멱등성(실패 경로 강제): 이미 분석돼 있으면 analyze를 다시 부르지 않는다 ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_idempotent_no_reanalyze(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    _stub_analyze(monkeypatch)
    user = await _make_user(db_session, "idem@resume")
    await _upload_document(client, user.id, _make_pdf(MINIMAL_TEXT_PDF_TEXT), "resume")
    cid = await _create_consultation(client, user.id)

    first = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert first.json()["attached"] is True

    # 2회차엔 analyze가 호출되면 안 된다 — 호출되면 즉시 실패시키는 폭탄으로 교체.
    async def _boom(_text: str) -> dict:
        raise AssertionError("이미 분석된 상담에서 재분석(LLM 재호출)이 발생하면 안 된다")

    monkeypatch.setattr(resume, "analyze", _boom)
    second = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert second.status_code == 200, second.text
    assert second.json()["attached"] is True  # 재분석 없이 기존 결과 반환


# ── 실패 경로: 손상 PDF는 삼켜서 attached=false, 상담은 계속 진행 가능 ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_broken_pdf_silently_skipped(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    _stub_analyze(monkeypatch)
    user = await _make_user(db_session, "broken@resume")
    # 업로드는 %PDF- 서명만 보므로 통과하지만, 자동연결의 extract_text는 실패한다.
    await _upload_document(client, user.id, BROKEN_PDF, "resume")
    cid = await _create_consultation(client, user.id)

    res = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert res.status_code == 200, res.text  # 5xx가 아니라 조용한 no-op이어야 함
    assert res.json()["attached"] is False
    consultation = await db_session.get(Consultation, cid)
    assert consultation.resume is None


# ── 실패 경로: LLM 분석 실패도 삼켜서 attached=false ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_llm_failure_silently_skipped(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))

    async def _fail(_text: str) -> dict:
        raise RuntimeError("LLM 흔들림")

    monkeypatch.setattr(resume, "analyze", _fail)
    user = await _make_user(db_session, "llmfail@resume")
    await _upload_document(client, user.id, _make_pdf(MINIMAL_TEXT_PDF_TEXT), "resume")
    cid = await _create_consultation(client, user.id)

    res = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["attached"] is False
    consultation = await db_session.get(Consultation, cid)
    assert consultation.resume is None


# ── 실패 경로: DB엔 이력서 행이 있는데 파일이 사라졌으면 크래시 없이 no-op ──
@pytest.mark.asyncio(loop_scope="session")
async def test_autoconnect_missing_file_skipped(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    _stub_analyze(monkeypatch)
    user = await _make_user(db_session, "ghostfile@resume")
    # 파일을 만들지 않고 storage_key만 있는 유령 행을 심는다.
    ghost = UserDocument(
        user_id=user.id,
        kind="resume",
        original_name="gone.pdf",
        storage_key="user-documents/does/not/exist.pdf",
        mime_type="application/pdf",
        size_bytes=10,
    )
    db_session.add(ghost)
    await db_session.commit()
    cid = await _create_consultation(client, user.id)

    res = await client.post(
        f"/api/consultations/{cid}/resume/from-storage",
        headers={"X-User-Id": str(user.id)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["attached"] is False


# ── 소유권: 가장 최근 이력서를 고른다(created_at desc, id desc) ──
@pytest.mark.asyncio(loop_scope="session")
async def test_latest_stored_resume_prefers_newest(db_session):
    user = await _make_user(db_session, "newest@resume")
    older = UserDocument(
        user_id=user.id, kind="resume", original_name="old.pdf",
        storage_key="user-documents/x/old.pdf", mime_type="application/pdf", size_bytes=1,
    )
    newer = UserDocument(
        user_id=user.id, kind="resume", original_name="new.pdf",
        storage_key="user-documents/x/new.pdf", mime_type="application/pdf", size_bytes=1,
    )
    db_session.add(older)
    await db_session.commit()
    db_session.add(newer)
    await db_session.commit()

    picked = await resume._latest_stored_resume(db_session, user)
    assert picked is not None and picked.id == newer.id

    # portfolio만 있는 사용자는 None (kind=resume만 대상).
    other = await _make_user(db_session, "onlyport@resume")
    db_session.add(
        UserDocument(
            user_id=other.id, kind="portfolio", original_name="p.pdf",
            storage_key="user-documents/y/p.pdf", mime_type="application/pdf", size_bytes=1,
        )
    )
    await db_session.commit()
    assert await resume._latest_stored_resume(db_session, other) is None
