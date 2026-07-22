"""라우터/DB 연동 테스트 인프라.

실제 Postgres(로컬 도커 db)에 대해 요청마다 SAVEPOINT 트랜잭션으로 격리한다 — 라우터
코드가 내부에서 session.commit()을 호출해도(추천/설문 등) 커밋은 SAVEPOINT 해제로만
끝나고, 테스트가 끝나면 바깥 트랜잭션을 롤백해 DB에 흔적이 남지 않는다.

DB/HTTP가 필요한 테스트만 db_session/client fixture를 쓴다. 순수 로직 테스트는 기존처럼
fixture 없이 함수 직접 호출.

engine의 asyncpg 커넥션은 만든 이벤트 루프에 종속된다 — pytest-asyncio가 테스트마다
새 루프를 쓰면(기본값) 이전 테스트에서 연 커넥션을 다른 루프에서 재사용하다 깨진다
("another operation is in progress"). loop_scope="session"으로 전체 테스트 세션이
루프 하나를 공유하게 고정한다. fixture는 function-scope 그대로라 세션당 SAVEPOINT
격리는 유지된다.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import engine, get_session
from app.main import app


@pytest_asyncio.fixture(loop_scope="session")
async def db_session():
    async with engine.connect() as conn:
        await conn.begin()
        session = AsyncSession(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


@pytest_asyncio.fixture(loop_scope="session")
async def client(db_session):
    async def _override_get_session():
        yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    # 테스트는 X-User-Id 개발 스텁으로 인증한다 → dev auth 명시적 활성화.
    # allow_dev_auth 기본값이 secure-by-default로 False라, 여기서 안 켜면 X-User-Id가 401.
    _prev_dev_auth = settings.allow_dev_auth
    settings.allow_dev_auth = True
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    settings.allow_dev_auth = _prev_dev_auth
    app.dependency_overrides.pop(get_session, None)
