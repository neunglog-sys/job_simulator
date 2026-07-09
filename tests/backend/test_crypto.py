"""core/crypto — AES-256-GCM 암호화·레거시 호환·이메일 해시."""

import pytest

from app.core.crypto import decrypt_str, email_hash, encrypt_str


def test_roundtrip():
    assert decrypt_str(encrypt_str("홍길동")) == "홍길동"


def test_ciphertext_not_plaintext():
    enc = encrypt_str("kim@test.com")
    assert enc.startswith("enc:v1:")
    assert "kim@test.com" not in enc


def test_same_input_different_ciphertext():
    # GCM 랜덤 nonce — 같은 평문도 암호문이 매번 달라야 함
    assert encrypt_str("같은 값") != encrypt_str("같은 값")


def test_legacy_plaintext_passthrough():
    # 암호화 도입 이전 데이터는 그대로 반환
    assert decrypt_str("평문 레거시 데이터") == "평문 레거시 데이터"


def test_tampered_ciphertext_rejected():
    enc = encrypt_str("변조 테스트")
    tampered = enc[:-4] + ("AAAA" if enc[-4:] != "AAAA" else "BBBB")
    with pytest.raises(Exception):
        decrypt_str(tampered)


def test_email_hash_deterministic_and_normalized():
    assert email_hash("Kim@Test.com ") == email_hash("kim@test.com")
    assert email_hash("kim@test.com") != email_hash("other@test.com")
    assert len(email_hash("kim@test.com")) == 64
