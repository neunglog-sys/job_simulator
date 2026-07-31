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
        max_tokens: int | None = None,
        thinking_budget: int | None = None,
    ) -> str:
        """단발 응답. json_schema를 주면 해당 스키마의 JSON 문자열을 반환.

        max_tokens: 출력 토큰 상한. None(기본)이면 모델 기본값 그대로 — 기존 호출부(잡 생성 등)는
        영향 없음. 응답 길이를 제어해야 하는 호출부(상담 등)만 명시적으로 넘긴다.
        """
        ...

    def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
        thinking_budget: int | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        """토큰 단위 스트리밍 응답."""
        ...
