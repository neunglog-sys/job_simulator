"""현장 용어 풀이 — 제목·업무 절차의 전문용어에 괄호로 뜻을 병기.

왜: 우리 사용자는 "이 직무를 아직 모르는 사람"이다. 그런데 콘텐츠가 현장 용어를 그대로 쓴다.
    예) "급이 전 개체 및 환경 점검" — 급이(給餌)가 사료 주기라는 걸 모르면 첫 화면부터 막힌다.
    용어를 없애면 현장감이 사라지므로, 없애지 말고 처음 나올 때 뜻만 붙인다.
    → "급이(사료 주기) 전 개체(가축 한 마리) 및 환경 점검"

원칙:
  · 스텝 안에서 **처음 나올 때 한 번만** 병기 (같은 말에 괄호가 반복되면 읽기 나빠진다)
  · 취준생이 모를 만한 현장 용어만. 일반 단어("확인", "기록")는 건드리지 않는다
  · 이미 괄호 풀이가 있으면 그대로 둔다
  · 뜻은 짧게(2~10자). 설명이 길면 절차가 안 읽힌다

무엇을 바꾸나: step.title · task.hints.answer_guide (브리핑에 그대로 나가는 텍스트)
무엇을 안 바꾸나: NPC 대사(mission)는 사람 말투라 괄호가 어색하다 — 모르면 NPC에게 물어보면 된다.
                 정답 키·보기 key·개수도 불변.

사용법 (호스트, LLM 환경변수 필요):
  python scripts/gloss-jargon.py --slug ms-06 --check
  python scripts/gloss-jargon.py --all
"""

import argparse
import asyncio
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "api"))
sys.path.insert(0, "/app")

from app.llm import get_llm  # noqa: E402
from app.llm.base import ChatMessage  # noqa: E402

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "terms": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "term": {"type": "string", "minLength": 1, "maxLength": 20},
                    "gloss": {"type": "string", "minLength": 2, "maxLength": 14},
                },
                "required": ["term", "gloss"],
            },
        }
    },
    "required": ["terms"],
}

_SYSTEM = """당신은 직무 체험 게임의 콘텐츠 에디터입니다. 이 게임의 사용자는 **그 직무를 아직 모르는
사람**(진로를 탐색하는 학생·취업준비생)입니다.

주어진 텍스트에서 **그런 사용자가 뜻을 모를 만한 현장 전문용어**만 골라 짧은 풀이를 답하세요.

고를 것:
  · 그 업계에서만 쓰는 말, 한자어 전문용어, 줄임말
  · 예: "급이"→"사료 주기", "개체"→"가축 한 마리", "로트"→"생산 묶음 번호", "여신"→"외상 한도"

고르지 않을 것:
  · 일반인이 아는 말: 확인, 기록, 점검, 보고, 정리, 준비, 온도, 습도, 안전모 …
  · 이미 괄호로 뜻이 붙어 있는 말
  · 맥락으로 바로 알 수 있는 합성어

풀이는 **2~10자**로 아주 짧게. 정의가 아니라 '아, 그거구나' 하게만 하면 됩니다.
모를 만한 용어가 없으면 terms를 빈 배열로 두세요. 억지로 만들지 마세요.
term은 원문에 있는 글자 그대로 적으세요."""


# 용어 뒤에 이어져도 단어가 안 깨지는 것들 — 조사·어미. 그 외 한글이 붙으면 합성어의 일부다.
_PARTICLES = (
    "을", "를", "이", "가", "은", "는", "의", "에", "와", "과", "로", "도", "만",
    "한", "해", "하", "된", "될", "인", "부터", "까지", "에서", "으로", "에게", "께",
)


def _standalone(text: str, term: str, start: int) -> bool:
    """이 위치의 term이 홀로 선 단어인가 — 뒤에 한글 명사가 이어붙으면 합성어라 쪼개면 안 된다.

    예) "출고지시서"의 '출고'에 풀이를 넣으면 "출고(물건을 내보냄)지시서"가 되어 단어가 깨진다.
        "급이 전"·"급이를"은 뒤가 공백·조사라 안전하다.
    """
    tail = text[start + len(term):]
    if not tail or not ("가" <= tail[0] <= "힣"):
        return True  # 공백·문장부호·끝 → 안전
    return tail.startswith(_PARTICLES)


def _gloss_first(text: str, terms: list[dict]) -> str:
    """각 용어가 '홀로 선' 자리에 처음 나올 때만 괄호 병기. 이미 풀이가 있으면 건너뛴다."""
    for item in terms:
        term, gloss = item["term"], item["gloss"]
        if not term or f"{term}(" in text:  # 이미 풀이가 붙어 있음
            continue
        start = -1
        while (start := text.find(term, start + 1)) != -1:
            if _standalone(text, term, start):
                text = f"{text[:start]}{term}({gloss}){text[start + len(term):]}"
                break
        # 홀로 선 자리가 없으면(합성어 안에만 있으면) 이 용어는 병기하지 않는다
    return text


async def terms_for(step: dict) -> list[dict]:
    guide = ((step.get("task") or {}).get("hints") or {}).get("answer_guide") or ""
    title = step.get("title") or ""
    if not guide and not title:
        return []
    out = await get_llm().chat_json(
        [ChatMessage(role="user", content=f"[제목] {title}\n[업무 절차] {guide}")],
        system=_SYSTEM,
        json_schema=_SCHEMA,
        temperature=0.2,
    )
    return out.get("terms") or []


async def main() -> None:
    parser = argparse.ArgumentParser(description="제목·절차의 현장 용어에 뜻 병기")
    parser.add_argument("--slug")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.slug and not args.all:
        parser.error("--slug 또는 --all 이 필요합니다")

    paths = (
        sorted(Path("data/scenarios").glob("*.yaml"))
        if args.all
        else [Path(f"data/scenarios/{args.slug}.yaml")]
    )
    changed = glossed = 0
    for path in paths:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        dirty = False
        for step in doc.get("steps", []):
            try:
                terms = await terms_for(step)
            except Exception as exc:  # noqa: BLE001 — 한 스텝 실패가 전체를 막지 않게
                print(f"  ⚠️  {path.stem} {step['id']}: {type(exc).__name__}")
                continue
            if not terms:
                continue
            new_title = _gloss_first(step.get("title") or "", terms)
            hints = (step.get("task") or {}).get("hints") or {}
            new_guide = _gloss_first(hints.get("answer_guide") or "", terms)
            if new_title == step.get("title") and new_guide == hints.get("answer_guide"):
                continue
            glossed += len(terms)
            if args.check:
                print(f"\n── {path.stem} {step['id']} ──")
                print("  용어:", ", ".join(f"{t['term']}({t['gloss']})" for t in terms))
                if new_title != step.get("title"):
                    print(f"  제목: {step['title']!r}\n     → {new_title!r}")
                if new_guide != hints.get("answer_guide"):
                    print(f"  절차: {new_guide[:110]!r}")
            else:
                step["title"] = new_title
                if new_guide:
                    step["task"]["hints"]["answer_guide"] = new_guide
                dirty = True
        if dirty:
            header = [ln for ln in path.read_text(encoding="utf-8").splitlines()[:5] if ln.startswith("#")]
            body = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=120)
            path.write_text("\n".join(header) + ("\n" if header else "") + body, encoding="utf-8")
            changed += 1
            print(f"✏️  {path.name}")

    print(f"\n{'검토만 (미적용)' if args.check else f'{changed}개 파일 갱신'} · 용어 {glossed}건")


if __name__ == "__main__":
    asyncio.run(main())
