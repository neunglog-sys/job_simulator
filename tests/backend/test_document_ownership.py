"""문서 API 소유권 격리 — 다른 사용자 문서는 목록·다운로드·삭제 모두 404.

impersonation 방지: 요청의 임의 user_id가 아니라 인증된 사용자(get_current_user)만 기준.
(가연 마이페이지 PR 리뷰 후속 — 2-user 통합 테스트)
"""

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import User, UserDocument

MINIMAL_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


async def _make_user(db_session, email: str) -> User:
    user = User(email=email, email_hash=f"doc-owner:{email}", name=email)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _upload(client, user_id: int) -> int:
    resp = await client.post(
        "/api/profile/documents",
        headers={"X-User-Id": str(user_id)},
        data={"kind": "resume"},
        files={"file": ("resume.pdf", MINIMAL_PDF, "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio(loop_scope="session")
async def test_document_ownership_isolated(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))  # 실제 storage 오염 방지
    alice = await _make_user(db_session, "alice@doc")
    bob = await _make_user(db_session, "bob@doc")

    doc_id = await _upload(client, alice.id)

    # ── Bob 입장: Alice 문서에 접근 불가 ──
    listed = await client.get("/api/profile/documents", headers={"X-User-Id": str(bob.id)})
    assert listed.status_code == 200
    assert all(d["id"] != doc_id for d in listed.json()), "Bob 목록에 Alice 문서가 보이면 안 됨"

    dl = await client.get(
        f"/api/profile/documents/{doc_id}/download", headers={"X-User-Id": str(bob.id)}
    )
    assert dl.status_code == 404, "타인 문서 다운로드는 404여야 함"

    de = await client.delete(
        f"/api/profile/documents/{doc_id}", headers={"X-User-Id": str(bob.id)}
    )
    assert de.status_code == 404, "타인 문서 삭제는 404여야 함"

    # ── Alice 문서는 Bob의 삭제 시도에도 그대로 살아있어야 ──
    dl_owner = await client.get(
        f"/api/profile/documents/{doc_id}/download", headers={"X-User-Id": str(alice.id)}
    )
    assert dl_owner.status_code == 200, "본인 문서는 다운로드 가능해야 함"

    still = await db_session.execute(select(UserDocument).where(UserDocument.id == doc_id))
    assert still.scalar_one_or_none() is not None, "Bob의 404 삭제가 실제로 지우면 안 됨"


@pytest.mark.asyncio(loop_scope="session")
async def test_document_list_only_own(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    alice = await _make_user(db_session, "alice2@doc")
    bob = await _make_user(db_session, "bob2@doc")
    a_doc = await _upload(client, alice.id)
    b_doc = await _upload(client, bob.id)

    a_list = await client.get("/api/profile/documents", headers={"X-User-Id": str(alice.id)})
    a_ids = {d["id"] for d in a_list.json()}
    assert a_doc in a_ids and b_doc not in a_ids, "목록은 본인 문서만"
