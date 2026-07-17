"""시나리오 표현 다듬기 — 제목·업무 절차·보기 라벨을 LLM으로 일괄 재작성.

왜 (브라우저 검증에서 나온 것):
  ⑤ 제목이 "정상업무" — 상황유형(내부 분류)이 화면에 그대로 노출 (183개 중 180개)
  ④ 절차가 "① 보호구 ② 환경측정 ③ 개체관찰" 식 키워드 나열이라 뭘 하라는 건지 모호 (38%)
  ③ 보기가 절차와 글자까지 같아서, 브리핑에서 본 목록을 그대로 고르면 통과 (뜻 이해가 아니라 문자열 매칭)

무엇을 바꾸나 (data/scenarios/*.yaml 제자리 수정):
  step.title                     → 미션 내용 기반의 사용자용 제목 (step.type은 그대로 — 역량 매핑에 쓰임)
  task.hints.answer_guide        → ①②③ 문장형 절차 (사수 브리핑에 그대로 나감)
  task.options[].label           → 같은 행동을 절차와 '다른 표현'으로 (오답은 오답인 채로)

무엇을 안 바꾸나 (계약 보존):
  task.answer(정답 키) · options[].key · kind · criteria · pass_score · mission · guide · type
  → 라벨 텍스트만 갈아끼우므로 정답 매핑이 깨지지 않는다. 개수·키 집합이 달라지면 그 스텝은 건너뛴다.

사용법 (컨테이너 — LLM 실키 필요):
  docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml \
    exec -T api python scripts/polish-scenarios.py --slug ms-06 --check   # 미리보기
  ... --slug ms-06        # 한 시나리오만 적용
  ... --all               # 전체 적용 (data/는 컨테이너에서 읽기전용 → 호스트에서 실행할 것)

호스트 실행 시:
  python scripts/polish-scenarios.py --slug ms-06 --check
"""

import argparse
import asyncio
import re
import sys
from pathlib import Path

import yaml

# 호스트에선 services/api를, 컨테이너에선 /app(이미 sys.path)에 app 패키지가 있다.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "api"))
sys.path.insert(0, "/app")

from app.llm import get_llm  # noqa: E402
from app.llm.base import ChatMessage  # noqa: E402

_MARKS = "①②③④⑤⑥⑦⑧⑨⑩"

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string", "minLength": 2, "maxLength": 24},
        "procedure": {
            "type": "array",
            "minItems": 1,
            "maxItems": 10,
            "items": {"type": "string", "minLength": 6, "maxLength": 60},
        },
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "key": {"type": "string"},
                    "label": {"type": "string", "minLength": 4, "maxLength": 60},
                },
                "required": ["key", "label"],
            },
        },
    },
    "required": ["title", "procedure"],
}

_SYSTEM = """당신은 직무 체험 게임의 콘텐츠 에디터입니다. 신입이 하루 업무를 체험하는 시나리오의
표현을 다듬습니다. 사실을 새로 지어내지 말고, 주어진 미션·평가기준·기존 표현 안에서만 씁니다.

[title] 이 업무가 무엇인지 알려주는 짧은 제목. 6~14자 권장.
  - '정상업무', '자료·정보 누락' 같은 분류 용어를 쓰지 마세요. 무슨 일을 하는지가 드러나야 합니다.
  - 예: "급이 전 개체·환경 점검", "PR 1차 리뷰", "릴리스노트·인수인계 작성"

[procedure] 사수가 신입에게 알려주는 업무 절차. 기존 절차의 뜻을 유지하되 **완결된 문장**으로.
  - '~한다' 체. 각 항목은 하나의 행동. 순서 유지.
  - 예: "보호구" → "작업 전 보호구를 착용한다"
        "환경측정" → "축사의 온·습도와 환기 상태를 측정한다"
  - 기존에 이미 문장이면 거의 그대로 두되 어색한 곳만 다듬습니다.

[options] 과제 보기. **procedure와 같은 뜻이되 표현을 다르게** 씁니다.
  - 신입이 글자만 보고 베끼지 못하고 뜻을 이해해야 고를 수 있게 합니다.
  - 단어를 바꾸되 가리키는 행동은 같아야 합니다.
    예: procedure "축사의 온·습도와 환기 상태를 측정한다"
        → option  "온습도계와 환기 팬 상태를 확인한다"
  - **정답 여부를 절대 바꾸지 마세요.** 입력에 [정답]으로 표시된 보기는 여전히 올바른 행동이어야
    하고, [오답]으로 표시된 보기는 여전히 하면 안 되는 행동이어야 합니다.
  - key는 입력에 주어진 값을 그대로 돌려줍니다. 보기 개수도 그대로입니다."""


def _split(guide: str) -> list[str]:
    return [p.strip(" ,.·") for p in re.split(rf"\s*[{_MARKS}]\s*", guide or "") if p.strip(" ,.·")]


def _join(parts: list[str]) -> str:
    return " ".join(f"{_MARKS[i]} {p}" for i, p in enumerate(parts) if i < len(_MARKS))


async def polish_step(step: dict) -> dict | None:
    """한 스텝의 title·procedure·options 재작성안 생성. 계약이 깨지면 None."""
    task = step.get("task") or {}
    options = task.get("options") or []
    guide = (task.get("hints") or {}).get("answer_guide")
    if not guide:
        return None

    answer = task.get("answer") or {}
    correct = set(answer.get("keys") or ([answer["key"]] if answer.get("key") else []))
    # 서술형(write)은 보기가 없다 — 제목·절차만 다듬는다.
    listing = (
        "\n".join(
            f"- key={o['key']} [{'정답' if o['key'] in correct else '오답'}] {o['label']}" for o in options
        )
        if options
        else "(없음 — 서술형 과제라 보기가 없습니다. options는 빈 배열로 두세요.)"
    )
    user = (
        f"[현재 제목] {step.get('title')}  (상황유형: {step.get('type')})\n"
        f"[미션] {step.get('mission', '')[:400]}\n"
        f"[과제 지시] {task.get('prompt', '')[:300]}\n"
        f"[평가 기준] {' / '.join(task.get('criteria') or [])}\n"
        f"[현재 절차] {guide}\n"
        f"[현재 보기]\n{listing}\n\n"
        "위 내용으로 title·procedure·options를 다듬어 주세요. "
        "options는 key를 그대로 두고 label만 바꿉니다."
    )
    out = await get_llm().chat_json(
        [ChatMessage(role="user", content=user)], system=_SYSTEM, json_schema=_SCHEMA, temperature=0.4
    )

    # 계약 검증 — 키 집합·개수가 어긋나면 이 스텝은 건드리지 않는다(정답 매핑 보호)
    out.setdefault("options", [])
    got = {o["key"] for o in out["options"]}
    if got != {o["key"] for o in options} or len(out["options"]) != len(options):
        return None
    return out


def apply(step: dict, polished: dict) -> None:
    label_by_key = {o["key"]: o["label"] for o in polished.get("options") or []}
    step["title"] = polished["title"]
    step["task"]["hints"]["answer_guide"] = _join(polished["procedure"])
    for option in step["task"].get("options") or []:
        option["label"] = label_by_key[option["key"]]


async def main() -> None:
    parser = argparse.ArgumentParser(description="시나리오 제목·절차·보기 표현 다듬기")
    parser.add_argument("--slug", help="특정 시나리오만 (예: ms-06)")
    parser.add_argument("--all", action="store_true", help="전체 시나리오")
    parser.add_argument("--check", action="store_true", help="쓰지 않고 결과만 출력")
    parser.add_argument("--remaining", action="store_true", help="제목이 아직 상황유형 그대로인 스텝만")
    args = parser.parse_args()
    if not args.slug and not args.all:
        parser.error("--slug 또는 --all 중 하나가 필요합니다")

    paths = (
        sorted(Path("data/scenarios").glob("*.yaml"))
        if args.all
        else [Path(f"data/scenarios/{args.slug}.yaml")]
    )
    changed_files = skipped = 0
    for path in paths:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        dirty = False
        for step in doc.get("steps", []):
            if args.remaining and step.get("title") != step.get("type"):
                continue  # 이미 다듬어진 스텝은 건드리지 않는다
            try:
                polished = await polish_step(step)
            except Exception as exc:  # noqa: BLE001 — 한 스텝 실패가 전체를 막지 않게
                print(f"  ⚠️  {path.stem} {step['id']}: 생성 실패 ({type(exc).__name__})")
                skipped += 1
                continue
            if polished is None:
                skipped += 1
                continue
            if args.check:
                print(f"\n── {path.stem} {step['id']} ──")
                print(f"  제목: {step.get('title')!r} → {polished['title']!r}")
                print("  절차:")
                for before, after in zip(_split((step['task']['hints'] or {}).get('answer_guide', '')), polished["procedure"]):
                    print(f"    {before!r}\n      → {after!r}")
                for option in step["task"].get("options") or []:
                    new = next(o["label"] for o in polished["options"] if o["key"] == option["key"])
                    print(f"  보기 [{option['key']}] {option['label']!r}\n      → {new!r}")
            else:
                apply(step, polished)
                dirty = True
        if dirty:
            header = [ln for ln in path.read_text(encoding="utf-8").splitlines()[:5] if ln.startswith("#")]
            body = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=120)
            path.write_text("\n".join(header) + ("\n" if header else "") + body, encoding="utf-8")
            changed_files += 1
            print(f"✏️  {path.name}")

    print(f"\n{'검토만 (미적용)' if args.check else f'{changed_files}개 파일 갱신'} · 건너뜀 {skipped}스텝")


if __name__ == "__main__":
    asyncio.run(main())
