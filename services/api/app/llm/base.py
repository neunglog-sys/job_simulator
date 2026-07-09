"""LLM 프로바이더 공통 인터페이스 — docs/architecture §7."""

from dataclasses import dataclass
from typing import AsyncIterator, Protocol


@dataclass
class ChatMessage:
    role: str  # user | assistant
    content: str


class LLMError(Exception):
    pass


class LLMProvider(Protocol):
    name: str

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        temperature: float = 0.7,
    ) -> str:
        """단발 응답. json_schema를 주면 해당 스키마의 JSON 문자열을 반환."""
        ...

    def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """토큰 단위 스트리밍 응답."""
        ...
