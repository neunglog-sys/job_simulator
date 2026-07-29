"""LLM 게이트웨이 — 프로바이더 선택·폴백·호출 로깅.

- env LLM_PROVIDER(openai|gemini|mock)로 주 프로바이더 선택
- 주 프로바이더의 API 키가 없으면 키가 있는 다른 프로바이더 → 없으면 mock으로 폴백
- 모든 호출을 storage/logs/llm-YYYYMMDD.jsonl 에 기록 (비용·품질 튜닝 근거)
"""

import json
import logging
import time
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import AsyncIterator

from jsonschema import Draft202012Validator, ValidationError

from app.core.config import settings
from app.llm.base import ChatMessage, LLMProvider

logger = logging.getLogger(__name__)


def _select_provider() -> LLMProvider:
    from app.llm.providers.mock_provider import MockProvider

    has_key = {
        "openai": bool(settings.openai_api_key),
        # Vertex 모드는 api_key 대신 서비스계정으로 인증 → gemini 사용 가능으로 간주
        "gemini": bool(settings.gemini_api_key) or settings.google_genai_use_vertexai,
    }
    choice = settings.llm_provider
    if choice != "mock" and not has_key.get(choice, False):
        fallback = next((p for p, ok in has_key.items() if ok), "mock")
        logger.warning(
            "LLM_PROVIDER=%s 인데 API 키가 없음 → '%s'로 폴백. "
            ".env에 키를 설정하세요.", choice, fallback,
        )
        choice = fallback

    if choice == "openai":
        from app.llm.providers.openai_provider import OpenAIProvider
        return OpenAIProvider()
    if choice == "gemini":
        from app.llm.providers.gemini_provider import GeminiProvider
        return GeminiProvider()
    return MockProvider()


def _select_embedding_provider() -> LLMProvider:
    """임베딩 = Gemini(gemini-embedding-001 @1536)로 통일. 키 없으면 mock.

    OpenAI 임베딩과 벡터 공간이 다르므로 섞으면 안 됨 — 코퍼스·질의 모두 Gemini로
    통일하고, 프로바이더 전환 시에는 반드시 재임베딩한다(load_research).
    """
    if settings.gemini_api_key or settings.google_genai_use_vertexai:
        from app.llm.providers.gemini_provider import GeminiProvider
        return GeminiProvider()
    from app.llm.providers.mock_provider import MockProvider
    logger.warning(
        "GEMINI 인증(API키 또는 Vertex) 없음 → 임베딩 mock 사용 (검색 순위 무의미)."
    )
    return MockProvider()


class LLMGateway:
    def __init__(self, provider: LLMProvider, embedder: LLMProvider) -> None:
        self.provider = provider
        self.embedder = embedder

    def _log(
        self, kind: str, started: float, ok: bool, chars: int,
        error: str = "", provider: str | None = None,
    ) -> None:
        try:
            log_dir = Path(settings.storage_dir) / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            entry = {
                "ts": time.time(),
                "provider": provider or self.provider.name,
                "kind": kind,
                "latency_ms": round((time.time() - started) * 1000),
                "ok": ok,
                "output_chars": chars,
                "error": error,
            }
            with open(log_dir / f"llm-{date.today():%Y%m%d}.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError:  # 로깅 실패가 서비스를 막으면 안 됨
            logger.exception("LLM 호출 로그 기록 실패")

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
        started = time.time()
        try:
            out = await self.provider.chat(
                messages, system=system, json_schema=json_schema, temperature=temperature,
                max_tokens=max_tokens, thinking_budget=thinking_budget,
            )
        except Exception as e:
            self._log("chat", started, ok=False, chars=0, error=str(e))
            raise
        self._log("chat", started, ok=True, chars=len(out))
        return out

    async def chat_json(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        json_schema: dict,
        temperature: float = 0.3,
        thinking_budget: int | None = None,
    ) -> dict:
        """구조화 출력 — JSON 파싱 + 스키마 검증. 실패 시 1회 재시도.

        thinking_budget: Gemini는 사고 토큰이 기본 활성이고 **그 과정은 temperature와
        무관하게 흔들린다.** 채점처럼 같은 입력에 같은 출력이 나와야 하는 용도는 0으로
        꺼야 한다 — 온도만 0으로 낮춰서는 재현성이 잡히지 않는다(실측).
        """
        validator = Draft202012Validator(json_schema)
        for attempt in (1, 2):
            raw = await self.chat(
                messages, system=system, json_schema=json_schema, temperature=temperature,
                thinking_budget=thinking_budget,
            )
            try:
                obj = json.loads(raw)
                validator.validate(obj)  # 네이티브 구조화출력의 백스톱 — 스키마 위반도 차단
                return obj
            except (json.JSONDecodeError, ValidationError) as e:
                if attempt == 2:
                    raise
                logger.warning("LLM JSON 파싱/스키마 검증 실패, 재시도 (%s)", type(e).__name__)
        raise RuntimeError("unreachable")

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
        thinking_budget: int | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        started = time.time()
        chars = 0
        try:
            async for chunk in self.provider.chat_stream(
                messages, system=system, temperature=temperature,
                thinking_budget=thinking_budget, max_tokens=max_tokens,
            ):
                chars += len(chunk)
                yield chunk
        except Exception as e:
            self._log("stream", started, ok=False, chars=chars, error=str(e))
            raise
        self._log("stream", started, ok=True, chars=chars)


    async def embed(
        self, texts: list[str], *, task_type: str = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        started = time.time()
        try:
            vectors = await self.embedder.embed(texts, task_type=task_type)
        except Exception as e:
            self._log("embed", started, ok=False, chars=0, error=str(e), provider=self.embedder.name)
            raise
        self._log(
            "embed", started, ok=True, chars=sum(len(t) for t in texts),
            provider=self.embedder.name,
        )
        return vectors


@lru_cache
def get_llm() -> LLMGateway:
    return LLMGateway(_select_provider(), _select_embedding_provider())


async def warmup_llm() -> None:
    """chat_stream 첫 호출 콜드스타트(실측 ~2~3초)를 기동 시 선지불.

    ingest_knowledge가 부팅 시 embed는 이미 한 번 호출해 그 경로는 예열되지만, 상담·시뮬레이션이
    쓰는 chat_stream 경로는 아무도 건드리지 않아 실사용자의 첫 발화가 그 비용을 대신 낸다.
    avatar_service.warmup()과 동일한 선지불 패턴 — 실패해도 부팅을 막지 않는다.
    """
    try:
        async for _ in get_llm().chat_stream(
            [ChatMessage(role="user", content="ping")],
            temperature=0, thinking_budget=0, max_tokens=16,
        ):
            pass
    except Exception:
        logger.warning("LLM 워밍업 실패 — 실사용자가 콜드스타트 비용을 대신 지불하게 됨", exc_info=True)
