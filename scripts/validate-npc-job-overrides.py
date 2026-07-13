"""생성된 103개 직무별 NPC 오버라이드의 구조와 역할 분리를 검증한다."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "prompts" / "npc" / "jobs"
SCHEMA_PATH = DATA_DIR / "schema.json"
EXPECTED_STAGES = {"S1", "S2", "S3", "S4", "S5"}
EXPECTED_SITUATIONS = {"정상업무", "자료·정보 누락", "우선순위 충돌", "오류·안전위험", "보고·인계"}
PRIVATE_KEYS = {"success_criteria", "failure_patterns", "required_actions", "scores", "rubric"}


def _walk_npc_visible(value: Any, path: str = "") -> list[str]:
    errors: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key in PRIVATE_KEYS:
                errors.append(f"NPC 공개 영역에 비공개 키 존재: {child_path}")
            errors.extend(_walk_npc_visible(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            errors.extend(_walk_npc_visible(child, f"{path}[{index}]"))
    return errors


def validate() -> tuple[list[str], dict[str, int]]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    files = sorted(DATA_DIR.glob("J*.yaml"))
    errors: list[str] = []
    job_ids: set[str] = set()
    family_ids: set[str] = set()
    statuses: dict[str, int] = {}

    if len(files) != 103:
        errors.append(f"직무 파일 수: expected=103 actual={len(files)}")

    for path in files:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        for error in validator.iter_errors(doc):
            errors.append(f"{path.name}: schema {'.'.join(map(str, error.path))}: {error.message}")
        job_id = doc["job"]["job_id"]
        if job_id in job_ids:
            errors.append(f"{path.name}: job_id 중복 {job_id}")
        job_ids.add(job_id)
        family_ids.add(doc["job"]["family_id"])
        status = doc["review"]["status"]
        statuses[status] = statuses.get(status, 0) + 1

        stages = {stage["stage_id"] for stage in doc["kb_stages"]}
        if stages != EXPECTED_STAGES:
            errors.append(f"{path.name}: KB stage 불일치 {sorted(stages)}")
        if len(doc["prompt_contract"]["npc_visible"]["npc_roles"]) < 3:
            errors.append(f"{path.name}: 공통 NPC 역할 3명 미만")
        errors.extend(
            f"{path.name}: {message}"
            for message in _walk_npc_visible(doc["prompt_contract"]["npc_visible"])
        )

        for index, variant in enumerate(doc["content_variants"]):
            if len(variant["npc_visible"]["npc_roles"]) < 3:
                errors.append(f"{path.name}: variant[{index}] NPC 역할 3명 미만")
            errors.extend(
                f"{path.name}: variant[{index}] {message}"
                for message in _walk_npc_visible(variant["npc_visible"])
            )
            stage_ids = {stage["stage_id"] for stage in variant["stages"]}
            if not EXPECTED_STAGES.issubset(stage_ids):
                errors.append(f"{path.name}: variant[{index}] S1~S5 누락")
            situations = {mission["situation_type"] for mission in variant["missions"]}
            if situations != EXPECTED_SITUATIONS:
                errors.append(f"{path.name}: variant[{index}] 미션 5종 불일치 {sorted(situations)}")
            for stage in variant["stages"]:
                errors.extend(
                    f"{path.name}: stage {stage['stage_id']} {message}"
                    for message in _walk_npc_visible(stage["npc_visible"])
                )
            for mission in variant["missions"]:
                errors.extend(
                    f"{path.name}: mission {mission['situation_type']} {message}"
                    for message in _walk_npc_visible(mission["npc_visible"])
                )

        research_sources = doc["provenance"]["research_sources"]
        if status == "researched_needs_human_review":
            if not research_sources:
                errors.append(f"{path.name}: 보강 조사 출처 없음")
            for source in research_sources:
                if not str(source.get("url", "")).startswith("https://"):
                    errors.append(f"{path.name}: 올바르지 않은 조사 출처 URL")

    expected_ids = {f"J{number:03d}" for number in range(1, 104)}
    if job_ids != expected_ids:
        errors.append(f"직무 ID 집합 불일치 missing={sorted(expected_ids-job_ids)} extra={sorted(job_ids-expected_ids)}")
    if len(family_ids) != 24:
        errors.append(f"family 수: expected=24 actual={len(family_ids)}")
    if statuses.get("integrated_research") != 72:
        errors.append(f"통합조사 직무 수 불일치: {statuses.get('integrated_research', 0)}")
    if statuses.get("researched_needs_human_review") != 31:
        errors.append(f"보강조사 직무 수 불일치: {statuses.get('researched_needs_human_review', 0)}")

    return errors, {
        "files": len(files),
        "jobs": len(job_ids),
        "families": len(family_ids),
        "integrated": statuses.get("integrated_research", 0),
        "researched": statuses.get("researched_needs_human_review", 0),
    }


def main() -> None:
    errors, counts = validate()
    print(" ".join(f"{key}={value}" for key, value in counts.items()))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)
    print("PASS: 103개 직무 오버라이드의 스키마·역할분리·출처가 유효합니다.")


if __name__ == "__main__":
    main()
