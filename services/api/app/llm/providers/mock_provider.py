"""API 키 없이 개발할 때 쓰는 모의 프로바이더.

프론트엔드 개발·도커 배선 검증·CI에서 실제 LLM 호출 없이 전체 플로우를 돌릴 수 있다.
"""

import asyncio
import json
from typing import AsyncIterator

from app.llm.base import ChatMessage


def _fake_json(schema: dict) -> dict:
    """스키마의 required 키를 채운 더미 객체 생성."""
    out = {}
    props = schema.get("properties", {})
    for key in schema.get("required", list(props.keys())):
        t = props.get(key, {}).get("type", "string")
        if t == "string":
            out[key] = f"(mock {key})"
        elif t in ("number", "integer"):
            out[key] = 70
        elif t == "array":
            out[key] = []
        elif t == "object":
            out[key] = {}
        elif t == "boolean":
            out[key] = True
    return out


class MockProvider:
    name = "mock"

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        temperature: float = 0.7,
    ) -> str:
        if json_schema:
            return json.dumps(_fake_json(json_schema), ensure_ascii=False)
        last = messages[-1].content if messages else ""
        return (
            f"[mock 응답] '{last[:40]}' 잘 들었어요. "
            "혹시 평소에 어떤 일을 할 때 가장 몰입하게 되나요?"
        )

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        text = await self.chat(messages, system=system, temperature=temperature)
        for i in range(0, len(text), 8):
            await asyncio.sleep(0.02)  # 실제 스트리밍처럼 보이게
            yield text[i : i + 8]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """텍스트 해시 기반 결정적 벡터 — 검색 순위는 무의미하지만 파이프라인은 동작.

        내장 hash()는 프로세스마다 시드가 달라 재시작 후 값이 바뀌므로 sha256 사용.
        """
        import hashlib
        import random

        vectors = []
        for text in texts:
            seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")
            rng = random.Random(seed)
            vectors.append([rng.uniform(-1, 1) for _ in range(1536)])
        return vectors
