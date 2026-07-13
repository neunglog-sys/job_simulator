"""직무 탐색 코치 프롬프트를 실제 LLM으로 단독 점검한다.

프로덕션 자유대화 경로와 동일하게 avatar/system.md를 사용한다.
API 키나 서비스 계정은 저장하지 않고 프로젝트의 .env 설정을 따른다.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))


def _prepare_local_vertex_credentials() -> None:
    """Docker의 /app 경로를 로컬 저장소 경로로 바꿔 단독 테스트한다."""
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return
    raw = dotenv_values(ROOT / ".env").get("GOOGLE_APPLICATION_CREDENTIALS")
    if not raw:
        return
    configured = Path(raw)
    normalized = raw.replace("\\", "/")
    if not configured.exists() and normalized.startswith("/app/"):
        configured = ROOT / normalized.removeprefix("/app/")
    if configured.exists():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(configured.resolve())


_prepare_local_vertex_credentials()

from app.core.config import settings  # noqa: E402
from app.llm import get_llm  # noqa: E402
from app.llm.base import ChatMessage  # noqa: E402
from app.llm.prompts import render_prompt  # noqa: E402


QUESTION_CASES = [
    (
        "Q1",
        "문과 출신이고 경력도 없는데 데이터 분석 직무에 도전할 수 있을까요? "
        "처음 무엇부터 해야 하는지도 알려주세요.",
    ),
    (
        "Q2",
        "백엔드 개발자와 QA 테스터는 실제로 어떤 일을 하고, 어떤 성향에 더 잘 맞나요?",
    ),
    (
        "Q3",
        "실무 경험이 없을 때도 포트폴리오를 만들 수 있나요? 만들 수 있다면 순서를 알려주세요.",
    ),
    (
        "Q4",
        "신입 콘텐츠 마케터의 정확한 평균 연봉과 다음 달 채용 규모를 알려주세요.",
    ),
    (
        "Q5",
        "관심 있는 직무가 너무 많아서 하나를 못 고르겠어요. 현실적으로 비교하는 방법이 있나요?",
    ),
]

UNRESOLVED_CASES = [
    (
        "U1",
        "이력서를 고쳐서 20곳에 지원했는데 면접 연락이 한 번도 안 왔어요. "
        "계속 지원하라는 말로는 해결이 안 돼요.",
    ),
    (
        "U2",
        "포트폴리오를 완성하라는 조언을 여러 번 들었는데 매번 중간에 멈춰요. "
        "이번에도 첫 화면만 만들고 손을 놨어요.",
    ),
    (
        "U3",
        "적성 검사를 해도 결과가 매번 다르고 하고 싶은 일이 뭔지 여전히 모르겠어요.",
    ),
    (
        "U4",
        "코딩 기초 강의를 세 번 다시 들었는데 혼자 문제를 풀면 시작조차 못 하겠어요.",
    ),
    (
        "U5",
        "마케팅과 개발 직무를 비교해봤지만 둘 다 장단점이 비슷해 보여서 결정을 못 하겠어요. "
        "비교표를 또 만드는 건 도움이 안 됐어요.",
    ),
]


async def run(group: str) -> int:
    cases = QUESTION_CASES if group == "questions" else UNRESOLVED_CASES
    llm = get_llm()
    system = render_prompt(
        "avatar/system.md",
        summary=None,
        knowledge=None,
        safety_notes=None,
    )

    model = settings.gemini_model if llm.provider.name == "gemini" else "-"
    print(f"provider={llm.provider.name} model={model} group={group}")
    failures = 0
    for case_id, user_text in cases:
        try:
            answer = await llm.chat(
                [ChatMessage(role="user", content=user_text)],
                system=system,
                temperature=0.4,
            )
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"\n[{case_id}] 사용자\n{user_text}\n[{case_id}] ERROR\n{exc}")
            continue
        if not answer.strip():
            failures += 1
        print(f"\n[{case_id}] 사용자\n{user_text}\n[{case_id}] 직무 코치\n{answer.strip()}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--group",
        choices=("questions", "unresolved"),
        default="questions",
    )
    args = parser.parse_args()
    return asyncio.run(run(args.group))


if __name__ == "__main__":
    raise SystemExit(main())
