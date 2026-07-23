"""맞춤 제도 프로필 저장 API.

지키려는 것:
- 민감정보(장애 여부)가 동의 없이 저장되지 않을 것
- 부분 수정이 나머지 항목을 지우지 않을 것
- 지역명이 정식 명칭으로만 저장될 것 (정확 일치 매칭이라 '서울'로 저장되면 조용히 아무것도 안 걸린다)
"""

import pytest
from sqlalchemy import text

from app.models import User


async def _make_user(db_session, email: str) -> User:
    user = User(email=email, email_hash=f"policy-profile:{email}", name=email)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    return {"X-User-Id": str(user.id)}


@pytest.mark.asyncio(loop_scope="session")
async def test_saves_and_reads_back(client, db_session):
    user = await _make_user(db_session, "save@policy")
    resp = await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={
            "birth_year": 1993,
            "gender": "male",
            "region_ctpv": "경기도",
            "region_sgg": "양주시",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["region_sgg"] == "양주시"

    read = await client.get("/api/profile/policy-profile", headers=_headers(user))
    assert read.json()["birth_year"] == 1993
    assert read.json()["gender"] == "male"


@pytest.mark.asyncio(loop_scope="session")
async def test_partial_update_keeps_other_fields(client, db_session):
    """이사만 반영하려고 지역만 보냈는데 생년이 지워지면 안 된다."""
    user = await _make_user(db_session, "partial@policy")
    await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"birth_year": 1993, "gender": "male", "region_ctpv": "경기도"},
    )
    resp = await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"region_ctpv": "서울특별시"},
    )
    body = resp.json()
    assert body["region_ctpv"] == "서울특별시"
    assert body["birth_year"] == 1993
    assert body["gender"] == "male"


@pytest.mark.asyncio(loop_scope="session")
async def test_explicit_null_clears_field(client, db_session):
    user = await _make_user(db_session, "clear@policy")
    await client.patch(
        "/api/profile/policy-profile", headers=_headers(user), json={"birth_year": 1993}
    )
    resp = await client.patch(
        "/api/profile/policy-profile", headers=_headers(user), json={"birth_year": None}
    )
    assert resp.json()["birth_year"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_disability_requires_explicit_consent(client, db_session):
    """민감정보는 동의 없이 저장되면 안 된다(개인정보보호법 §23)."""
    user = await _make_user(db_session, "consent@policy")
    denied = await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"has_disability": True},
    )
    assert denied.status_code == 400

    await db_session.refresh(user)
    assert user.has_disability_enc is None  # 거절됐으면 흔적도 남지 않아야 한다

    allowed = await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"has_disability": True, "sensitive_agreed": True},
    )
    assert allowed.status_code == 200
    assert allowed.json()["has_disability"] is True
    assert allowed.json()["sensitive_agreed_at"] is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_disability_value_is_encrypted_at_rest(client, db_session):
    """민감정보라 DB에 평문으로 남으면 안 된다.

    ORM 속성은 EncryptedText가 복호화한 평문이라 그걸로는 확인이 안 된다.
    실제로 저장된 값을 보려면 타입 변환을 우회하는 raw SQL로 읽어야 한다.
    """
    user = await _make_user(db_session, "enc@policy")
    await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"has_disability": True, "sensitive_agreed": True},
    )
    stored = (
        await db_session.execute(
            text("SELECT has_disability_enc FROM users WHERE id = :id"), {"id": user.id}
        )
    ).scalar_one()
    assert stored is not None
    assert stored != "Y"  # 평문 그대로 저장되면 안 된다
    assert stored.startswith("enc:v1:")

    await db_session.refresh(user)
    assert user.has_disability is True  # 읽을 땐 정상 복호화


@pytest.mark.asyncio(loop_scope="session")
async def test_withdrawing_disability_clears_consent_record(client, db_session):
    """철회하면 동의 시각도 지워야 한다 — 값 없이 동의 기록만 남으면 동의한 사용자로 보인다."""
    user = await _make_user(db_session, "withdraw@policy")
    await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"has_disability": False, "sensitive_agreed": True},
    )
    resp = await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"has_disability": None},
    )
    assert resp.json()["has_disability"] is None
    assert resp.json()["sensitive_agreed_at"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_short_region_name_is_rejected(client, db_session):
    """'서울'로 저장되면 정확 일치 매칭에서 아무 제도도 안 걸린다 — 조용히 실패하느니 거절한다."""
    user = await _make_user(db_session, "region@policy")
    resp = await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(user),
        json={"region_ctpv": "서울"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio(loop_scope="session")
async def test_profile_is_isolated_per_user(client, db_session):
    """다른 사용자의 민감정보가 섞여 나오면 안 된다."""
    alice = await _make_user(db_session, "alice@policy")
    bob = await _make_user(db_session, "bob@policy")
    await client.patch(
        "/api/profile/policy-profile",
        headers=_headers(alice),
        json={"birth_year": 1993, "has_disability": True, "sensitive_agreed": True},
    )
    resp = await client.get("/api/profile/policy-profile", headers=_headers(bob))
    assert resp.json()["birth_year"] is None
    assert resp.json()["has_disability"] is None
