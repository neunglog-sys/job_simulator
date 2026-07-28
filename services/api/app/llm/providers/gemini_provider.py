import asyncio
import logging
from typing import AsyncIterator

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.core.config import settings
from app.llm.base import ChatMessage, LLMError

logger = logging.getLogger(__name__)

# Vertex gemini-3.6-flash 공식 단가(2026-07, Standard): 입력 $1.50 / 출력 $7.50 per 1M.
# 사고 토큰은 출력 단가로 과금된다("Output price (including thinking tokens)").
_USD_PER_INPUT_TOKEN = 1.50 / 1_000_000
_USD_PER_OUTPUT_TOKEN = 7.50 / 1_000_000


def _log_usage(api: str, res: object) -> None:
    """LLM 호출 1건의 실제 과금 토큰·추정비용을 로그로 남긴다.

    평가지표(9.4 '1콜당 토큰·비용')를 로그 파싱만으로 뽑기 위한 계측이다. 사고 토큰은
    응답 텍스트에 안 보이지만 출력으로 과금되므로 따로 찍어야 실제 비용이 보인다
    (실측: 추천·리포트 콜은 사고가 출력의 60~75%).
    """
    um = getattr(res, "usage_metadata", None)
    if um is None:
        return
    prompt = um.prompt_token_count or 0
    out = um.candidates_token_count or 0
    think = getattr(um, "thoughts_token_count", 0) or 0
    usd = prompt * _USD_PER_INPUT_TOKEN + (out + think) * _USD_PER_OUTPUT_TOKEN
    logger.info(
        "[LLM-USAGE] api=%s in=%d out=%d think=%d total=%d usd=%.6f",
        api, prompt, out, think, um.total_token_count or 0, usd,
    )


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
        _log_usage("chat", res)
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
                # usage_metadata는 **마지막 청크에만** 실린다(실측: 46청크 중 46번째에
                # in=1156/out=1112). 상담은 글자수 도달 시 aclose()로 조기 종료하므로
                # 그 청크에 도달하지 못한다 — 그때는 토큰을 알 수 없으니 잘렸다는 사실만
                # 남겨, 비용 집계가 '누락'인지 '0'인지 구분되게 한다.
                last_chunk = None
                try:
                    async for chunk in stream:
                        last_chunk = chunk
                        if chunk.text:
                            yielded = True
                            yield chunk.text
                except GeneratorExit:
                    logger.info("[LLM-USAGE] api=stream truncated=1 (조기 종료로 토큰 미집계)")
                    raise
                if yielded:
                    _log_usage("stream", last_chunk)
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
