import asyncio
import logging
from typing import AsyncIterator

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.core.config import settings
from app.llm.base import ChatMessage, LLMError

logger = logging.getLogger(__name__)


def _is_retryable(exc: Exception) -> bool:
    """일시 오류만 재시도. 4xx(429 제외)는 영구 오류라 재시도하지 않는다."""
    if isinstance(exc, genai_errors.ClientError):
        return getattr(exc, "code", None) == 429  # 4xx 중 rate-limit만
    return True  # ServerError(5xx)·타임아웃·전송오류 → 재시도


async def _with_retry(call, what: str):
    """일시 오류에 지수 백오프 재시도. 마지막 시도 실패·영구 오류면 그대로 raise."""
    attempts = settings.llm_max_retries + 1
    for attempt in range(1, attempts + 1):
        try:
            return await call()
        except Exception as e:  # noqa: BLE001 — 아래에서 재시도 가부 판단 후 재-raise
            if attempt >= attempts or not _is_retryable(e):
                raise
            delay = 0.5 * (2 ** (attempt - 1))
            logger.warning(
                "gemini %s 일시 오류, %.1fs 후 재시도 (%d/%d): %s", what, delay, attempt, attempts, e
            )
            await asyncio.sleep(delay)


class GeminiProvider:
    name = "gemini"

    def __init__(self) -> None:
        # 타임아웃 없으면 무응답 시 요청이 무한 대기 → 클라이언트 레벨로 상한을 건다.
        http_options = types.HttpOptions(timeout=settings.llm_timeout_ms)
        if settings.google_genai_use_vertexai:
            # Vertex AI (GCP $300 크레딧) — 인증은 GOOGLE_APPLICATION_CREDENTIALS(서비스계정 JSON)
            self._client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project or None,
                location=settings.google_cloud_location or None,
                http_options=http_options,
            )
        else:
            # Google AI Studio — API 키
            self._client = genai.Client(
                api_key=settings.gemini_api_key, http_options=http_options
            )
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
        max_tokens: int | None = None,
        thinking_budget: int | None = None,
    ) -> str:
        config = types.GenerateContentConfig(
            system_instruction=system, temperature=temperature,
            max_output_tokens=max_tokens,
        )
        # thinking을 끄지 않으면 사고 토큰이 max_output_tokens를 먹어 본문이 잘린다.
        if thinking_budget is not None:
            config.thinking_config = types.ThinkingConfig(thinking_budget=thinking_budget)
        if json_schema:
            config.response_mime_type = "application/json"
            # google-genai의 네이티브 JSON Schema 구조화 출력을 사용한다.
            config.response_json_schema = json_schema
        try:
            res = await _with_retry(
                lambda: self._client.aio.models.generate_content(
                    model=self._model,
                    contents=self._build_contents(messages),
                    config=config,
                ),
                "chat",
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
        thinking_budget: int | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        config_kwargs: dict = {"system_instruction": system, "temperature": temperature}
        if max_tokens is not None:
            config_kwargs["max_output_tokens"] = max_tokens
        if thinking_budget is not None:
            # Gemini는 thinking(사고 토큰)이 기본 활성 — 대화형 스트리밍에선 이 '보이지 않는
            # 사고'가 첫 토큰을 수 초 지연시킨다 (상담 실측: 첫토큰 6.7s → 0이면 1.2s).
            config_kwargs["thinking_config"] = types.ThinkingConfig(
                thinking_budget=thinking_budget
            )
        config = types.GenerateContentConfig(**config_kwargs)
        attempts = settings.llm_max_retries + 1
        for attempt in range(1, attempts + 1):
            yielded = False
            try:
                stream = await self._client.aio.models.generate_content_stream(
                    model=self._model,
                    contents=self._build_contents(messages),
                    config=config,
                )
                async for chunk in stream:
                    if chunk.text:
                        yielded = True
                        yield chunk.text
                if yielded:
                    return
            except Exception as e:  # noqa: BLE001
                # 이미 토큰을 내보낸 뒤면 재시도 시 중복 출력 → 재시도 불가, 그대로 실패
                if yielded or attempt >= attempts or not _is_retryable(e):
                    raise LLMError(f"gemini stream 실패: {e}") from e
                delay = 0.5 * (2 ** (attempt - 1))
                logger.warning(
                    "gemini stream 일시 오류, %.1fs 후 재시도 (%d/%d): %s",
                    delay, attempt, attempts, e,
                )
                await asyncio.sleep(delay)
                continue

            # 예외 없이 스트림이 끝났는데 텍스트가 하나도 없음(세이프티 필터 등) —
            # 그대로 두면 상위에서 "성공(ok=true, 0자)"으로 조용히 묻혀 재현·추적이 안 됨.
            if attempt >= attempts:
                raise LLMError("gemini stream 실패: 빈 응답(세이프티 필터 등으로 텍스트 없음)")
            delay = 0.5 * (2 ** (attempt - 1))
            logger.warning(
                "gemini stream 빈 응답, %.1fs 후 재시도 (%d/%d)",
                delay, attempt, attempts,
            )
            await asyncio.sleep(delay)

    async def embed(
        self, texts: list[str], *, task_type: str = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        """gemini-embedding-001 임베딩 — output_dimensionality로 1536 고정.

        문서 적재는 RETRIEVAL_DOCUMENT, 질의는 RETRIEVAL_QUERY로 분리해 검색 품질을 높인다.
        cosine 거리(scale-invariant)라 축소차원 미정규화여도 검색은 성립한다.
        """
        try:
            res = await _with_retry(
                lambda: self._client.aio.models.embed_content(
                    model=settings.embedding_model,
                    contents=texts,
                    config=types.EmbedContentConfig(
                        output_dimensionality=settings.embedding_dim,
                        task_type=task_type,
                    ),
                ),
                "embed",
            )
        except Exception as e:  # noqa: BLE001
            raise LLMError(f"gemini embed 실패: {e}") from e
        return [list(e.values) for e in res.embeddings]
