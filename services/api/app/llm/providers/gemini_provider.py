from typing import AsyncIterator

from google import genai
from google.genai import types

from app.core.config import settings
from app.llm.base import ChatMessage, LLMError


class GeminiProvider:
    name = "gemini"

    def __init__(self) -> None:
        if settings.google_genai_use_vertexai:
            # Vertex AI (GCP $300 크레딧) — 인증은 GOOGLE_APPLICATION_CREDENTIALS(서비스계정 JSON)
            self._client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project or None,
                location=settings.google_cloud_location or None,
            )
        else:
            # Google AI Studio — API 키
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
            # google-genai의 네이티브 JSON Schema 구조화 출력을 사용한다.
            config.response_json_schema = json_schema
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

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """gemini-embedding-001 임베딩 — output_dimensionality로 1536 고정.

        cosine 거리(scale-invariant)를 쓰므로 축소차원 미정규화여도 검색은 성립한다.
        task_type은 문서·질의 대칭(RETRIEVAL_DOCUMENT)으로 통일 — 필요 시 질의를
        RETRIEVAL_QUERY로 분리하면 검색 품질이 더 오른다(선택 최적화).
        """
        try:
            res = await self._client.aio.models.embed_content(
                model=settings.embedding_model,
                contents=texts,
                config=types.EmbedContentConfig(
                    output_dimensionality=settings.embedding_dim,
                    task_type="RETRIEVAL_DOCUMENT",
                ),
            )
        except Exception as e:  # noqa: BLE001
            raise LLMError(f"gemini embed 실패: {e}") from e
        return [list(e.values) for e in res.embeddings]
