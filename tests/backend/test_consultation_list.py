"""상담 목록 API가 기존 세션과 메시지를 대화방 목록 형태로 요약하는지 검증한다."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models import Consultation, Message, User


async def _make_user(db_session, email: str) -> User:
    user = User(email=email, email_hash=f"consultation-list:{email}", name="상담 목록 테스트")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio(loop_scope="session")
async def test_consultation_list_contains_title_preview_and_latest_date(client, db_session):
    user = await _make_user(db_session, "history@example.com")
    older = Consultation(user_id=user.id, status="completed")
    newer = Consultation(user_id=user.id, status="active")
    db_session.add_all([older, newer])
    await db_session.commit()
    await db_session.refresh(older)
    await db_session.refresh(newer)

    base_time = datetime(2026, 7, 20, 6, 0, tzinfo=UTC)
    db_session.add_all(
        [
            Message(
                consultation_id=older.id,
                role="user",
                content="콘텐츠 기획과 데이터 분석 중 어떤 일이 더 잘 맞을까요?",
                created_at=base_time,
            ),
            Message(
                consultation_id=older.id,
                role="assistant",
                content="두 직무에서 즐거웠던 경험부터 비교해볼게요.",
                created_at=base_time + timedelta(minutes=1),
            ),
            Message(
                consultation_id=newer.id,
                role="user",
                content="사람들과 협업하는 일을 좋아해요.",
                created_at=base_time + timedelta(days=1),
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        "/api/consultations", headers={"X-User-Id": str(user.id)}
    )

    assert response.status_code == 200
    items = response.json()
    assert [item["id"] for item in items] == [newer.id, older.id]
    assert items[0]["title"] == "사람들과 협업하는 일을 좋아해요."
    assert items[0]["message_count"] == 1
    assert items[1]["preview"] == "두 직무에서 즐거웠던 경험부터 비교해볼게요."
    assert items[1]["updated_at"].startswith("2026-07-20T06:01:00")


@pytest.mark.asyncio(loop_scope="session")
async def test_empty_consultation_has_safe_default_copy(client, db_session):
    user = await _make_user(db_session, "empty-history@example.com")
    consultation = Consultation(user_id=user.id, status="active")
    db_session.add(consultation)
    await db_session.commit()
    await db_session.refresh(consultation)

    response = await client.get(
        "/api/consultations", headers={"X-User-Id": str(user.id)}
    )

    assert response.status_code == 200
    item = response.json()[0]
    assert item["title"] == "새로운 상담"
    assert item["preview"] == "아직 나눈 대화가 없어요."
    assert item["message_count"] == 0


@pytest.mark.asyncio(loop_scope="session")
async def test_consultation_title_can_be_renamed(client, db_session):
    user = await _make_user(db_session, "rename-history@example.com")
    consultation = Consultation(user_id=user.id, status="active")
    db_session.add(consultation)
    await db_session.commit()
    await db_session.refresh(consultation)

    response = await client.patch(
        f"/api/consultations/{consultation.id}",
        headers={"X-User-Id": str(user.id)},
        json={"title": "  콘텐츠   기획 상담  "},
    )

    assert response.status_code == 200
    assert response.json() == {"id": consultation.id, "title": "콘텐츠 기획 상담"}

    list_response = await client.get(
        "/api/consultations", headers={"X-User-Id": str(user.id)}
    )
    assert list_response.json()[0]["title"] == "콘텐츠 기획 상담"


@pytest.mark.asyncio(loop_scope="session")
async def test_consultation_can_be_deleted_by_owner(client, db_session):
    user = await _make_user(db_session, "delete-history@example.com")
    consultation = Consultation(user_id=user.id, status="active")
    db_session.add(consultation)
    await db_session.commit()
    await db_session.refresh(consultation)
    db_session.add(
        Message(consultation_id=consultation.id, role="user", content="삭제할 상담")
    )
    await db_session.commit()

    response = await client.delete(
        f"/api/consultations/{consultation.id}",
        headers={"X-User-Id": str(user.id)},
    )

    assert response.status_code == 204
    list_response = await client.get(
        "/api/consultations", headers={"X-User-Id": str(user.id)}
    )
    assert list_response.json() == []
