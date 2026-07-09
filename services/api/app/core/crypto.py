"""개인정보 저장 암호화 — AES-256-GCM.

- 암호문 형식: "enc:v1:" + base64(nonce(12) + ciphertext+tag)
- 접두사가 없는 값은 암호화 도입 이전 레거시로 간주하고 그대로 반환
- EncryptedText: SQLAlchemy 타입 — 컬럼에 붙이면 저장/조회 시 자동 암·복호화
- email_hash: 암호화된 이메일은 WHERE 조회가 안 되므로 HMAC-SHA256 해시로 조회
"""

import base64
import hashlib
import hmac
import logging
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from app.core.config import settings

logger = logging.getLogger(__name__)

_PREFIX = "enc:v1:"
_NONCE_LEN = 12


@lru_cache
def _key() -> bytes:
    if settings.aes_key:
        key = base64.b64decode(settings.aes_key)
        if len(key) != 32:
            raise ValueError("AES_KEY는 base64 인코딩된 32바이트여야 함 (openssl rand -base64 32)")
        return key
    logger.warning("AES_KEY 미설정 → 개발용 고정키 사용. 시연 전 .env에 팀 공용 키를 설정하세요.")
    return hashlib.sha256(b"jobsimulator-dev-only-aes-key").digest()


def encrypt_str(value: str) -> str:
    nonce = os.urandom(_NONCE_LEN)
    ciphertext = AESGCM(_key()).encrypt(nonce, value.encode(), None)
    return _PREFIX + base64.b64encode(nonce + ciphertext).decode()


def decrypt_str(value: str) -> str:
    if not value.startswith(_PREFIX):
        return value  # 암호화 도입 이전 레거시 평문
    raw = base64.b64decode(value[len(_PREFIX):])
    plaintext = AESGCM(_key()).decrypt(raw[:_NONCE_LEN], raw[_NONCE_LEN:], None)
    return plaintext.decode()


def email_hash(email: str) -> str:
    """조회용 결정적 해시 — 대소문자·공백 정규화 후 HMAC."""
    normalized = email.strip().lower().encode()
    return hmac.new(_key(), normalized, hashlib.sha256).hexdigest()


class EncryptedText(TypeDecorator):
    """저장 시 AES-256-GCM 암호화, 조회 시 복호화하는 투명 컬럼 타입."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt_str(value) if value is not None else None

    def process_result_value(self, value, dialect):
        return decrypt_str(value) if value is not None else None
