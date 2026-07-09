from typing import AsyncIterator

from openai import AsyncOpenAI

from app.core.config import settings
from app.llm.base import ChatMessage, LLMError


class OpenAIProvider:
    name = "openai"

    def __init__(self) -> None:
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_model

    def _build_messages(
        self, messages: list[ChatMessage], system: str | None
    ) -> list[dict]:
        out = []
        if system:
            out.append({"role": "system", "content": system})
        out.extend({"role": m.role, "content": m.content} for m in messages)
        return out

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        temperature: float = 0.7,
    ) -> str:
        kwargs: dict = {}
        if json_schema:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "output", "schema": json_schema, "strict": True},
            }
        try:
            res = await self._client.chat.completions.create(
                model=self._model,
                messages=self._build_messages(messages, system),
                temperature=temperature,
                **kwargs,
            )
        except Exception as e:  # noqa: BLE001 — 게이트웨이에서 폴백 처리
            raise LLMError(f"openai chat 실패: {e}") from e
        return res.choices[0].message.content or ""

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        try:
            stream = await self._client.chat.completions.create(
                model=self._model,
                messages=self._build_messages(messages, system),
                temperature=temperature,
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:  # noqa: BLE001
            raise LLMError(f"openai stream 실패: {e}") from e
