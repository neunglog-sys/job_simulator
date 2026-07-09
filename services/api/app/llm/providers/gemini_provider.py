import json
from typing import AsyncIterator

from google import genai
from google.genai import types

from app.core.config import settings
from app.llm.base import ChatMessage, LLMError


class GeminiProvider:
    name = "gemini"

    def __init__(self) -> None:
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.gemini_model

    @staticmethod
    def _build_contents(messages: list[ChatMessage]) -> list[dict]:
        role_map = {"user": "user", "assistant": "model"}
        return [
            {"role": role_map.get(m.role, "user"), "parts": [{"text": m.content}]}
            for m in messages
        ]

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        temperature: float = 0.7,
    ) -> str:
        config = types.GenerateContentConfig(
            system_instruction=system, temperature=temperature
        )
        if json_schema:
            config.response_mime_type = "application/json"
            # 스키마는 프롬프트에 명시해 강제 (genai 스키마 객체 변환 대신 단순화)
            messages = messages + [
                ChatMessage(
                    role="user",
                    content="반드시 다음 JSON 스키마에 맞는 JSON만 출력:\n"
                    + json.dumps(json_schema, ensure_ascii=False),
                )
            ]
        try:
            res = await self._client.aio.models.generate_content(
                model=self._model,
                contents=self._build_contents(messages),
                config=config,
            )
        except Exception as e:  # noqa: BLE001
            raise LLMError(f"gemini chat 실패: {e}") from e
        return res.text or ""

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        config = types.GenerateContentConfig(
            system_instruction=system, temperature=temperature
        )
        try:
            stream = await self._client.aio.models.generate_content_stream(
                model=self._model,
                contents=self._build_contents(messages),
                config=config,
            )
            async for chunk in stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:  # noqa: BLE001
            raise LLMError(f"gemini stream 실패: {e}") from e
