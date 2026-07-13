"""레거시 데모 직무(marketer, backend-developer)에 interest_profile 채우기.

generate_recommendation_jobs.py가 다루는 103개 직무는 연구 카탈로그(data/prompts/npc/jobs)의
"직무 사실 정보"를 근거로 interest_profile을 생성하지만, marketer.yaml/backend-developer.yaml은
그 카탈로그 밖의 독립 데모 직무라 같은 방식으로 만들 수 없다. 대신 기존 title/description/
competencies를 근거로, 같은 RIASEC 라벨·앵커·스키마를 재사용해 일관된 기준으로 평가한다.

data/jobs는 컨테이너에 read-only로 마운트되어 있어 여기서 바로 못 쓴다 — 결과는
storage/generated-jobs/ 에 쓰고, 호스트에서 data/jobs로 복사한다.

사용: docker compose exec api python -m app.scripts.generate_legacy_interest_profile
"""

import asyncio
import logging
import os

import yaml

from app.core.config import settings
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.scripts.generate_recommendation_jobs import RIASEC_ANCHORS, RIASEC_DIMS, RIASEC_LABELS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SRC_DIR = os.path.join(settings.data_dir, "jobs")
OUT_DIR = os.path.join(settings.storage_dir, "generated-jobs")
CODES = ["marketer", "backend-developer"]

SYSTEM_PROMPT = """당신은 진로 체험 플랫폼의 직무 콘텐츠 작가입니다.
여러 직무의 title·description·역량 매트릭스가 함께 주어집니다. 각 직무에 대해
진로 흥미유형(RIASEC, Holland 모형) 6개 차원 각각에 대해 이 직무가 요구/부합하는
정도를 1~5 정수로 평가하세요. 6개 차원: """ + ", ".join(
    f"{k}({v})" for k, v in RIASEC_LABELS.items()
) + """
""" + RIASEC_ANCHORS + """
- 함께 주어진 직무들을 서로 비교하며 평가하세요. 직무 성격이 다르면 반드시 프로필도
  달라야 합니다. 6개 차원에 모두 비슷한 점수를 주는 것은 금지됩니다.

입력으로 주어진 직무 개수와 정확히 같은 개수의 결과를 code 기준으로 반환하세요.
"""


def _schema(codes: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "jobs": {
                "type": "array",
                "minItems": len(codes),
                "maxItems": len(codes),
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "enum": codes},
                        "interest_profile": {
                            "type": "object",
                            "properties": {
                                k: {"type": "integer", "minimum": 1, "maximum": 5}
                                for k in RIASEC_DIMS
                            },
                            "required": RIASEC_DIMS,
                            "additionalProperties": False,
                        },
                    },
                    "required": ["code", "interest_profile"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["jobs"],
        "additionalProperties": False,
    }


async def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    docs = {}
    for code in CODES:
        with open(os.path.join(SRC_DIR, f"{code}.yaml"), encoding="utf-8") as f:
            docs[code] = yaml.safe_load(f)

    body = "\n\n".join(
        f"### code: {code}\n제목: {doc['title']}\n설명: {doc['description']}\n"
        f"역량 매트릭스: {doc['competencies']}"
        for code, doc in docs.items()
    )
    result = await get_llm().chat_json(
        [ChatMessage(role="user", content=f"## 직무 목록\n{body}")],
        system=SYSTEM_PROMPT,
        json_schema=_schema(CODES),
        temperature=0.5,
    )

    returned = {item["code"]: item["interest_profile"] for item in result.get("jobs", [])}
    for code, doc in docs.items():
        interest_profile = returned.get(code)
        if interest_profile is None:
            logger.error("응답 누락 code=%s", code)
            continue
        doc["interest_profile"] = interest_profile
        body_yaml = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=100)
        with open(os.path.join(OUT_DIR, f"{code}.yaml"), "w", encoding="utf-8") as f:
            f.write(body_yaml)
        logger.info("완료 code=%s interest_profile=%s", code, interest_profile)


if __name__ == "__main__":
    asyncio.run(main())
