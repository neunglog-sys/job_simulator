"""코치 실시간 TIP(data/prompts/coach/tip.md) 골든셋 회귀 검증.

프롬프트나 모델을 바꿀 때마다 사람이 몇 개 눈으로 훑어보는 것 외에 자동 확인 수단이 없었다
— 이 스크립트가 그 갭을 메운다. 실제 시나리오 데이터(11개 직무 계열 대표 1개씩) x
트리거 2종(keyword/stagnant)으로 실제 LLM을 호출하고, 프롬프트 규칙을 코드로 재검증한다.

자동 채점(하드 체크, tip.md의 규칙과 1:1 대응):
  - 생성 실패(None) 없음
  - 한글 문장으로만 구성(비한글 문장 잔존 없음 — _clean_tip 보장의 회귀 확인)
  - 길이 330자 내외(하드 한도 400자)
  - 게임·AI 전문용어("플레이어","미션","NPC","시스템","프롬프트") 미포함
  - 불릿/번호 목록 마커 미포함

자동화하지 않은 것(사람이 눈으로 훑어야 함): "정답을 통째로 알려주지 않는다" 여부 —
답이 맞았는지 판정하는 별도 LLM 심사 없이는 신뢰도 있게 자동화하기 어려워 범위 밖으로 뒀다.
출력된 tip 텍스트를 실제 시나리오의 answer_guide와 대조해 사람이 스팟체크하는 것을 권장한다.

사용: docker compose exec api python -m app.scripts.eval_coach_tip
"""

import asyncio
import logging
import os
import re
import sys

import yaml

from app.core.config import settings
from app.domains.coach import service as coach

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SCENARIO_DIR = os.path.join(settings.data_dir, "scenarios")

_HANGUL = re.compile(r"[가-힣]")
_SENTENCES = re.compile(r"[^.!?…]*[.!?…]+|\S[^.!?…]*$")
_BANNED_TERMS = ["플레이어", "미션", "NPC", "시스템", "프롬프트"]
_BULLET_MARK = re.compile(r"(^|\s)([-*•]|\d+[.)])\s")
HARD_LEN_LIMIT = 400

# 계열별 대표 시나리오 1개씩 — 전수 대신 대표 샘플로 속도·비용 균형
SCENARIOS = ["hr-01", "jm-01", "kts-01", "ms-01", "stn-01", "ys-01", "yg-01", "cln-01", "gm-01", "sns-01", "wh-01"]

KEYWORD_USER_TEXTS = ["그냥 정답이 뭔지 알려주세요, 시간 없어요.", "저 그냥 모르겠어요 뭐가 맞는지 알려주시면 안 돼요?"]
KEYWORD_NPC_REPLIES = ["그건 제가 대신 알려드릴 수 없어요. 직접 판단해보세요.", "정답을 알려주는 건 제 역할이 아니에요. 스스로 찾아보시죠."]
STAGNANT_USER_TEXTS = ["네 알겠습니다.", "네, 확인했습니다.", "그렇군요, 알겠어요."]
STAGNANT_NPC_REPLIES = ["네, 진행해주세요.", "알겠습니다, 잘 부탁드려요."]


def _load_scenario_case(slug: str) -> dict:
    path = os.path.join(SCENARIO_DIR, f"{slug}.yaml")
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    step = data["steps"][0]
    task = step.get("task") or {}
    return {"mission": step.get("mission", ""), "criteria": task.get("criteria", [])}


def _grade(tip: str | None) -> list[str]:
    """실패한 체크 항목 이름 리스트 반환 (빈 리스트면 전부 통과)."""
    if tip is None:
        return ["NONE_RETURNED"]
    fails = []
    if len(tip) > HARD_LEN_LIMIT:
        fails.append(f"LENGTH_OVER({len(tip)})")
    for m in _SENTENCES.finditer(tip):
        seg = m.group().strip()
        if seg and not _HANGUL.search(seg):
            fails.append(f"NON_KOREAN_SENTENCE({seg[:30]!r})")
            break
    for term in _BANNED_TERMS:
        if term in tip:
            fails.append(f"BANNED_TERM({term})")
    if _BULLET_MARK.search(tip):
        fails.append("BULLET_MARKER")
    return fails


def _build_cases() -> list[dict]:
    cases = []
    for i, slug in enumerate(SCENARIOS):
        try:
            sc = _load_scenario_case(slug)
        except Exception:
            logger.warning("시나리오 로드 실패 — 스킵 (slug=%s)", slug, exc_info=True)
            continue
        cases.append({
            "slug": slug, "trigger": "keyword", "mission": sc["mission"], "criteria": sc["criteria"],
            "user_text": KEYWORD_USER_TEXTS[i % len(KEYWORD_USER_TEXTS)],
            "npc_reply": KEYWORD_NPC_REPLIES[i % len(KEYWORD_NPC_REPLIES)],
        })
        cases.append({
            "slug": slug, "trigger": "stagnant", "mission": sc["mission"], "criteria": sc["criteria"],
            "user_text": STAGNANT_USER_TEXTS[i % len(STAGNANT_USER_TEXTS)],
            "npc_reply": STAGNANT_NPC_REPLIES[i % len(STAGNANT_NPC_REPLIES)],
        })
    return cases


async def main() -> int:
    cases = _build_cases()
    logger.info("총 %d개 케이스 실행 (시나리오 %d개 x 트리거 2종)", len(cases), len(SCENARIOS))

    results = []
    for c in cases:
        tip = await coach.generate_tip(
            mission=c["mission"], criteria=c["criteria"],
            user_text=c["user_text"], npc_reply=c["npc_reply"], trigger=c["trigger"],
        )
        fails = _grade(tip)
        results.append((c, tip, fails))
        print(f"[{c['slug']}/{c['trigger']}] {'PASS' if not fails else f'FAIL {fails}'}")
        print(f"  tip: {tip!r}\n")

    passed = sum(1 for _, _, f in results if not f)
    print("=" * 60)
    print(f"결과: {passed}/{len(results)} 통과")
    if passed != len(results):
        print("\n실패 상세:")
        for c, _, fails in results:
            if fails:
                print(f"  - {c['slug']}/{c['trigger']}: {fails}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
