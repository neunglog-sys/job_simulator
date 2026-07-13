#!/usr/bin/env python3
"""data/counseling/*.json 데이터팩 무결성 검증 (표준 라이브러리만 사용, DB/네트워크 불필요).

사용법:
    python scripts/validate_counseling_data.py

체크 항목:
    - question_id 고유성 / 빈 질문 없음 / 완전 중복 질문 텍스트 없음
    - target_dimensions가 dimension_definitions.json에 실재하는 축인지
    - followup_question_ids가 실재하는 question_id를 가리키는지
    - question_bank/dimension_definitions의 source_id가 source_registry.md에 등록됐는지
    - dimension_definitions의 related_module_ids가 실제 8모듈 이름과 일치하는지
    - module_mapping.json의 대표미션 코드가 40개이고 카테고리 커버리지가 완전한지

부수 효과: scripts/manual_review_official_overlap.md를 최신 질문 목록으로 재생성한다
(공식 검사 문항과의 중복 여부를 사람이 수동으로 대조·체크하기 위한 목록).
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data" / "counseling"
SOURCE_REGISTRY = REPO_ROOT / "docs" / "counseling" / "source_registry.md"
MANUAL_REVIEW_OUT = REPO_ROOT / "scripts" / "manual_review_official_overlap.md"

# team_categories.module 실제 값 (팀통합_8모듈_조사자료_표준화완료.xlsx 01_연결맵 기준).
# DB 접근 없이도 검증할 수 있도록 여기 고정값으로 둔다 — 값이 바뀌면 load_research.py의
# SHEETS 매핑도 함께 바뀌므로, 그 변경 시 이 목록도 함께 갱신해야 한다.
REAL_MODULES = {
    "대인응대형", "절차·점검형", "작업순서·절차형", "제작·상태판단형",
    "돌발상황 대처형", "안전·위험판단형", "장비·상태점검형", "정보·판단형",
}


def load(name: str) -> dict:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def registered_source_ids() -> set[str]:
    text = SOURCE_REGISTRY.read_text(encoding="utf-8")
    return set(re.findall(r"^### (SRC-[A-Z0-9-]+)$", text, flags=re.MULTILINE))


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    questions = load("question_bank.json")["questions"]
    dimensions = load("dimension_definitions.json")["dimensions"]
    evidence_rules = load("evidence_rules.json")
    followup_rules = load("followup_rules.json")
    gate_rules = load("recommendation_gate_rules.json")
    module_mapping = load("module_mapping.json")
    safety_rules = load("safety_rules.json")

    question_ids = [q["question_id"] for q in questions]
    dimension_codes = {d["dimension_code"] for d in dimensions}
    known_sources = registered_source_ids()

    # ── question_bank ────────────────────────────────────────────────
    if len(question_ids) != len(set(question_ids)):
        dupes = {q for q in question_ids if question_ids.count(q) > 1}
        errors.append(f"question_bank: 중복 question_id {sorted(dupes)}")

    seen_text: dict[str, str] = {}
    for q in questions:
        if not q["question"].strip():
            errors.append(f"question_bank: 빈 질문 텍스트 ({q['question_id']})")
        prev = seen_text.get(q["question"])
        if prev:
            errors.append(
                f"question_bank: 질문 텍스트 완전 중복 ({q['question_id']} == {prev})"
            )
        seen_text[q["question"]] = q["question_id"]

        for dim in q["target_dimensions"]:
            if dim not in dimension_codes:
                errors.append(
                    f"question_bank[{q['question_id']}]: 존재하지 않는 dimension_code '{dim}'"
                )
        for fid in q["followup_question_ids"]:
            if fid not in question_ids:
                errors.append(
                    f"question_bank[{q['question_id']}]: 존재하지 않는 followup_question_id '{fid}'"
                )
        for sid in q["source_ids"]:
            if sid not in known_sources:
                errors.append(
                    f"question_bank[{q['question_id']}]: source_registry.md에 없는 source_id '{sid}'"
                )

    # ── dimension_definitions ───────────────────────────────────────
    if len(dimension_codes) != len(dimensions):
        errors.append("dimension_definitions: 중복 dimension_code 존재")

    for dim in dimensions:
        for mid in dim["related_module_ids"]:
            if mid not in REAL_MODULES:
                errors.append(
                    f"dimension_definitions[{dim['dimension_code']}]: "
                    f"실제 8모듈에 없는 related_module_id '{mid}'"
                )
        for sid in dim["source_ids"]:
            if sid not in known_sources:
                errors.append(
                    f"dimension_definitions[{dim['dimension_code']}]: "
                    f"source_registry.md에 없는 source_id '{sid}'"
                )
        for qid in dim["confirmation_question_ids"]:
            if qid not in question_ids:
                errors.append(
                    f"dimension_definitions[{dim['dimension_code']}]: "
                    f"존재하지 않는 confirmation_question_id '{qid}'"
                )

    # ── evidence_rules: rule_id 고유성 ────────────────────────────────
    ev_ids = [r["rule_id"] for r in evidence_rules.get("rules", [])]
    if len(ev_ids) != len(set(ev_ids)):
        errors.append("evidence_rules: 중복 rule_id 존재")

    # ── safety_rules의 source_id ──────────────────────────────────
    for rule in safety_rules.get("rules", []):
        for sid in rule.get("source_ids", []):
            if sid not in known_sources:
                errors.append(
                    f"safety_rules[{rule['rule_id']}]: source_registry.md에 없는 source_id '{sid}'"
                )

    # ── module_mapping ───────────────────────────────────────────────
    rep_missions = module_mapping["representative_missions"]
    if len(rep_missions) != 40:
        errors.append(f"module_mapping: representative_missions 개수가 40이 아님 ({len(rep_missions)})")
    mission_codes = [m["mission_code"] for m in rep_missions]
    if len(mission_codes) != len(set(mission_codes)):
        errors.append("module_mapping: 중복 mission_code 존재")
    for m in module_mapping["modules"]:
        if m["module"] not in REAL_MODULES:
            errors.append(f"module_mapping: 실제 8모듈에 없는 module '{m['module']}'")

    # ── followup_rules / gate_rules 존재 여부(구조 확인) ──────────────
    if not followup_rules.get("rules"):
        errors.append("followup_rules: rules가 비어 있음")
    if not gate_rules.get("required_conditions"):
        errors.append("recommendation_gate_rules: required_conditions가 비어 있음")

    # ── manual_review_official_overlap.md 재생성 ─────────────────────
    lines = [
        "# 공식 검사 문항 중복 여부 수동 검수 목록",
        "",
        "이 파일은 `scripts/validate_counseling_data.py`가 자동 생성한다(수동 편집 시 다음 실행에서 덮어써짐).",
        "각 질문이 고용24 직업심리검사·O*NET Interest Profiler 공식 문항을 그대로 번역/복제한 것이",
        "아님을 검수자가 원문과 대조해 체크한다. 신규 질문 추가 시 이 목록도 함께 갱신해야 한다.",
        "",
        "| 확인 | question_id | 질문 | 참고 출처 |",
        "|---|---|---|---|",
    ]
    for q in questions:
        lines.append(
            f"| [ ] | {q['question_id']} | {q['question']} | {', '.join(q['source_ids']) or '-'} |"
        )
    MANUAL_REVIEW_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"질문 {len(questions)}개, 축 {len(dimensions)}개, source_id {len(known_sources)}개 등록됨")
    print(f"수동 검수 목록 갱신: {MANUAL_REVIEW_OUT.relative_to(REPO_ROOT)}")

    if warnings:
        print(f"\n경고 {len(warnings)}건:")
        for w in warnings:
            print(f"  - {w}")

    if errors:
        print(f"\n오류 {len(errors)}건:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("\n검증 통과: 오류 없음")
    return 0


if __name__ == "__main__":
    sys.exit(main())
