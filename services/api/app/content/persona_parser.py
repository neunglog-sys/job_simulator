"""영수님 family 페르소나(data/prompts/npc/personas/F*.md) → 구조화 필드 파서.

통짜 페르소나 프롬프트에서 성격·가치관·말버릇을 뽑아 NPC yaml 필드(personality/speech_habits)로
옮기기 위한 것. family의 역할 원형(사수/상급자·동료·고객)을 build_scenarios 아키타입에 매핑한다.
"""

import re
from pathlib import Path

from app.core.config import settings

# 역할 원형 괄호 키워드 → build_scenarios 아키타입
_ARCH_KEYWORDS = {
    "mentor": ["사수", "상급자", "선임", "수석"],
    "colleague": ["동료", "협업", "전문가"],
    "counterpart": ["고객", "외부인", "수강생", "민원", "환자", "승객", "방문"],
}


def _arch_of(role_paren: str) -> str:
    for arch, keys in _ARCH_KEYWORDS.items():
        if any(k in role_paren for k in keys):
            return arch
    return "colleague"


def _quotes(text: str) -> list[str]:
    return [q.strip() for q in re.findall(r"[“”\"]([^“”\"]+)[“”\"]", text) if q.strip()]


def _sentences(text: str, limit: int) -> list[str]:
    text = re.sub(r"예:.*$", "", text).strip()
    parts = re.split(r"[.。]\s*", text)
    return [p.strip() for p in parts if len(p.strip()) >= 4][:limit]


def _field(block: str, name: str) -> str:
    m = re.search(rf"- \*\*{name}\*\*:\s*(.+)", block)
    return m.group(1).strip() if m else ""


def parse_family(path: Path) -> dict:
    """F##.md 1개 → {family_id, module, name, by_arch: {arch: {personality, speech_habits, role}}}."""
    s = path.read_text(encoding="utf-8")
    module = (re.search(r"^- 모듈:\s*(.+)$", s, re.M) or [None, ""])[1].strip()
    fname = re.search(r"^#\s*(F\d+)\s+(.+?)\s*—", s, re.M)
    family_id = fname.group(1) if fname else path.name[:3]
    name = fname.group(2).strip() if fname else ""

    by_arch: dict[str, dict] = {}
    for m in re.finditer(r"^## NPC \d+ — (.+?)\n(.*?)(?=^## |\Z)", s, re.M | re.S):
        label, block = m.group(1), m.group(2)
        paren = re.search(r"\(([^)]+)\)", label)
        arch = _arch_of(paren.group(1) if paren else "")
        entry = {
            "role": label.split("(")[0].strip(),
            "personality": _sentences(_field(block, "성격"), 2) + _sentences(_field(block, "가치관"), 1),
            "speech_habits": (_quotes(_field(block, "말버릇")) or _quotes(_field(block, "말투")))[:3],
        }
        by_arch.setdefault(arch, entry)  # 같은 아키타입 여러 명이면 첫 번째 (보통 대표)
    return {"family_id": family_id, "module": module, "name": name, "by_arch": by_arch}


def load_families() -> dict[str, dict]:
    """모든 family 파싱 → {family_id: parsed}. 파일 없으면 빈 dict (아키타입 baseline 폴백)."""
    base = Path(settings.data_dir) / "prompts" / "npc" / "personas"
    out = {}
    for path in sorted(base.glob("F*.md")):
        parsed = parse_family(path)
        out[parsed["family_id"]] = parsed
    return out
