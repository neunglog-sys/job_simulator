"""llm — mock 프로바이더 (키 없는 개발 환경의 토대라 회귀 방지 중요)."""

import asyncio
import json

from app.llm.providers.mock_provider import MockProvider, _fake_json


def test_fake_json_fills_required_keys():
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "score": {"type": "integer"},
            "items": {"type": "array"},
            "ok": {"type": "boolean"},
        },
        "required": ["name", "score", "items", "ok"],
    }
    out = _fake_json(schema)
    assert set(out) == {"name", "score", "items", "ok"}
    assert isinstance(out["score"], int)
    assert isinstance(out["items"], list)


def test_mock_chat_json_parses():
    provider = MockProvider()
    schema = {"type": "object", "properties": {"x": {"type": "string"}}, "required": ["x"]}
    raw = asyncio.run(provider.chat([], json_schema=schema))
    assert "x" in json.loads(raw)


def test_mock_stream_matches_chat():
    provider = MockProvider()

    async def collect():
        return "".join([c async for c in provider.chat_stream([])])

    assert "몰입" in asyncio.run(collect())


def test_mock_embed_deterministic_and_sized():
    provider = MockProvider()
    v1, v2 = asyncio.run(provider.embed(["같은 텍스트", "같은 텍스트"]))
    assert v1 == v2  # 같은 입력 → 같은 벡터 (재시작 후에도 동일해야 검색이 성립)
    assert len(v1) == 1536
    [v3] = asyncio.run(provider.embed(["다른 텍스트"]))
    assert v3 != v1
