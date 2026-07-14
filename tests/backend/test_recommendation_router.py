"""추천 라우터 통합 테스트 — 실제 DB(SAVEPOINT 격리) + mock LLM으로 HTTP 플로우 전체 검증.

conftest.py의 client/db_session fixture 사용. LLM은 실제 프로바이더 대신 MockProvider로
고정해 비용·비결정성 없이 aptitude_clarity 게이트를 통과하는 더미 프로필을 받는다.
"""

import pytest
import pytest_asyncio

import app.domains.recommendation.service as rec_service
from app.llm.gateway import LLMGateway
from app.llm.providers.mock_provider import MockProvider
from app.models import Consultation, Message, User


@pytest_asyncio.fixture
async def mock_llm(monkeypatch):
    gateway = LLMGateway(provider=MockProvider(), embedder=MockProvider())
    monkeypatch.setattr(rec_service, "get_llm", lambda: gateway)
    return gateway


async def _make_user(db_session, email: str) -> User:
    user = User(email=email, email_hash=f"test-hash:{email}", name="라우터 테스트")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_consultation_with_message(db_session, user: User) -> Consultation:
    consultation = Consultation(user_id=user.id, status="active")
    db_session.add(consultation)
    await db_session.commit()
    await db_session.refresh(consultation)
    db_session.add(
        Message(
            consultation_id=consultation.id,
            role="user",
            content="저는 사람 만나서 이야기 나누는 걸 좋아해요.",
        )
    )
    await db_session.commit()
    return consultation


@pytest.mark.asyncio(loop_scope="session")
async def test_create_get_and_feedback_flow(client, db_session, mock_llm):
    user = await _make_user(db_session, "flow@example.com")
    consultation = await _make_consultation_with_message(db_session, user)
    headers = {"X-User-Id": str(user.id)}

    create_resp = await client.post(
        "/api/recommendations", json={"consultation_id": consultation.id}, headers=headers
    )
    assert create_resp.status_code == 201
    body = create_resp.json()
    assert 1 <= len(body["results"]) <= 5
    assert body["feedback"] is None
    rec_id = body["id"]

    get_resp = await client.get(f"/api/recommendations/{rec_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == rec_id

    fb_resp = await client.patch(
        f"/api/recommendations/{rec_id}/feedback",
        json={"feedback": "helpful"},
        headers=headers,
    )
    assert fb_resp.status_code == 200
    assert fb_resp.json()["feedback"] == "helpful"


@pytest.mark.asyncio(loop_scope="session")
async def test_get_recommendation_wrong_owner_is_404(client, db_session, mock_llm):
    owner = await _make_user(db_session, "owner@example.com")
    other = await _make_user(db_session, "other@example.com")
    consultation = await _make_consultation_with_message(db_session, owner)

    create_resp = await client.post(
        "/api/recommendations",
        json={"consultation_id": consultation.id},
        headers={"X-User-Id": str(owner.id)},
    )
    rec_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/recommendations/{rec_id}", headers={"X-User-Id": str(other.id)}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_create_recommendation_without_messages_is_400(client, db_session, mock_llm):
    user = await _make_user(db_session, "empty@example.com")
    consultation = Consultation(user_id=user.id, status="active")
    db_session.add(consultation)
    await db_session.commit()
    await db_session.refresh(consultation)

    resp = await client.post(
        "/api/recommendations",
        json={"consultation_id": consultation.id},
        headers={"X-User-Id": str(user.id)},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_rejects_invalid_value(client, db_session, mock_llm):
    user = await _make_user(db_session, "fb@example.com")
    consultation = await _make_consultation_with_message(db_session, user)
    create_resp = await client.post(
        "/api/recommendations",
        json={"consultation_id": consultation.id},
        headers={"X-User-Id": str(user.id)},
    )
    rec_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/recommendations/{rec_id}/feedback",
        json={"feedback": "meh"},
        headers={"X-User-Id": str(user.id)},
    )
    assert resp.status_code == 422
