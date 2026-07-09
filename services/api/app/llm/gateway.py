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

from app.core.config import settings
from app.llm.base import ChatMessage, LLMProvider

logger = logging.getLogger(__name__)


def _select_provider() -> LLMProvider:
    from app.llm.providers.mock_provider import MockProvider

    has_key = {
        "openai": bool(settings.openai_api_key),
        "gemini": bool(settings.gemini_api_key),
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


class LLMGateway:
    def __init__(self, provider: LLMProvider) -> None:
        self.provider = provider

    def _log(self, kind: str, started: float, ok: bool, chars: int, error: str = "") -> None:
        try:
            log_dir = Path(settings.storage_dir) / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            entry = {
                "ts": time.time(),
                "provider": self.provider.name,
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
    ) -> str:
        started = time.time()
        try:
            out = await self.provider.chat(
                messages, system=system, json_schema=json_schema, temperature=temperature
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
    ) -> dict:
        """구조화 출력 — 파싱 실패 시 1회 재시도."""
        for attempt in (1, 2):
            raw = await self.chat(
                messages, system=system, json_schema=json_schema, temperature=temperature
            )
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                if attempt == 2:
                    raise
                logger.warning("LLM JSON 파싱 실패, 재시도 (raw=%.200s)", raw)
        raise RuntimeError("unreachable")

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        started = time.time()
        chars = 0
        try:
            async for chunk in self.provider.chat_stream(
                messages, system=system, temperature=temperature
            ):
                chars += len(chunk)
                yield chunk
        except Exception as e:
            self._log("stream", started, ok=False, chars=chars, error=str(e))
            raise
        self._log("stream", started, ok=True, chars=chars)


@lru_cache
def get_llm() -> LLMGateway:
    return LLMGateway(_select_provider())
