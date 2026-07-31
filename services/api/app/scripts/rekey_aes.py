"""AES 키 교체(re-key) — 이전 키로 복호화해 현재 키(.env의 AES_KEY)로 재암호화.

사용법:
  1. .env에 새 AES_KEY 설정 후 컨테이너 재생성 (--force-recreate)
  2. docker compose exec api python -m app.scripts.rekey_aes
  3. (기본) 이전 키 = 개발용 고정키. 다른 키에서 교체하면 OLD_AES_KEY env로 지정

이미 새 키로 암호화된 행은 복호화 실패를 감지하고 건너뜀 (재실행 안전).
"""

import asyncio
import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import text

from app.core import crypto
from app.core.config import settings

_PREFIX = "enc:v1:"


def _old_key() -> bytes:
    if os.environ.get("OLD_AES_KEY"):
        return base64.b64decode(os.environ["OLD_AES_KEY"])
    return hashlib.sha256(b"jobsimulator-dev-only-aes-key").digest()  # 개발용 고정키


def _old_decrypt(value: str) -> str | None:
    """이전 키로 복호화. 이미 새 키로 암호화된 값이면 None(스킵)."""
    if not value.startswith(_PREFIX):
        return value  # 평문 레거시
    raw = base64.b64decode(value[len(_PREFIX):])
    try:
        return AESGCM(_old_key()).decrypt(raw[:12], raw[12:], None).decode()
    except InvalidTag:
        return None


async def main() -> None:
    if not settings.aes_key:
        raise SystemExit("중단: .env에 AES_KEY(새 키)가 없습니다. 설정 후 컨테이너 재생성 필요.")

    from app.core.db import SessionFactory

    rekeyed = skipped = 0
    async with SessionFactory() as s:
        for uid, email, name in (await s.execute(text("SELECT id, email, name FROM users"))).all():
            sets, params = [], {"id": uid}
            for col, value in (("email", email), ("name", name)):
                if not value:
                    continue
                plain = _old_decrypt(value)
                if plain is None:
                    continue
                sets.append(f"{col} = :{col}")
                params[col] = crypto.encrypt_str(plain)
                if col == "email":
                    sets.append("email_hash = :ehash")
                    params["ehash"] = crypto.email_hash(plain)
            if sets:
                await s.execute(text(f"UPDATE users SET {', '.join(sets)} WHERE id = :id"), params)
                rekeyed += 1
            else:
                skipped += 1

        for table, col in (("messages", "content"), ("consultations", "summary")):
            for rid, value in (
                await s.execute(text(f"SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL"))
            ).all():
                plain = _old_decrypt(value)
                if plain is None:
                    skipped += 1
                    continue
                await s.execute(
                    text(f"UPDATE {table} SET {col} = :v WHERE id = :id"),
                    {"v": crypto.encrypt_str(plain), "id": rid},
                )
                rekeyed += 1

        await s.commit()
    print(f"re-key 완료: 재암호화 {rekeyed}건, 스킵(이미 새 키/빈 값) {skipped}건")


if __name__ == "__main__":
    asyncio.run(main())
