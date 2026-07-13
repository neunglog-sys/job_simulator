"""data/ 폴더의 YAML 콘텐츠 로더."""

from pathlib import Path

import yaml

from app.core.config import settings

REQUIRED_JOB_KEYS = {"code", "title", "description", "competencies"}
REQUIRED_SCENARIO_KEYS = {"job", "slug", "title", "initial_state", "steps", "npcs"}


def _load_yaml_dir(subdir: str) -> list[tuple[str, dict]]:
    base = Path(settings.data_dir) / subdir
    results = []
    for path in sorted(base.glob("*.yaml")):
        with open(path, encoding="utf-8") as f:
            results.append((path.name, yaml.safe_load(f)))
    return results


def load_jobs() -> list[dict]:
    jobs = []
    for filename, doc in _load_yaml_dir("jobs"):
        missing = REQUIRED_JOB_KEYS - doc.keys()
        if missing:
            raise ValueError(f"data/jobs/{filename}: 필수 키 누락 {missing}")
        doc.setdefault("interest_profile", {})  # 선택 필드 — 없으면 역량 점수만으로 추천
        jobs.append(doc)
    return jobs


def validate_scenario(doc: dict, source: str) -> None:
    """시나리오 문서 구조 검증 — YAML 시드와 변환 스크립트(build_scenarios) 공용."""
    missing = REQUIRED_SCENARIO_KEYS - doc.keys()
    if missing:
        raise ValueError(f"{source}: 필수 키 누락 {missing}")
    step_ids = {s["id"] for s in doc["steps"]}
    for step in doc["steps"]:
        for tr in step.get("transitions", []):
            if tr["to"] not in step_ids:
                raise ValueError(
                    f"{source}: step '{step['id']}'의 전이 대상 '{tr['to']}'가 존재하지 않음"
                )
        task = step.get("task")
        if task:
            t_missing = {"prompt", "criteria", "on_pass"} - task.keys()
            if t_missing:
                raise ValueError(f"{source}: step '{step['id']}' task 필수 키 누락 {t_missing}")
            if task["on_pass"] != "__end__" and task["on_pass"] not in step_ids:
                raise ValueError(
                    f"{source}: step '{step['id']}'의 on_pass '{task['on_pass']}'가 존재하지 않음"
                )
    reserved = {"step", "attempts", "quest"} & set(doc.get("initial_state", {}))
    if reserved:
        raise ValueError(f"{source}: initial_state에 예약 키 사용 불가 {reserved}")
    quest = doc.get("sudden_quest")
    if quest:
        if len(doc["steps"]) < 2:
            raise ValueError(
                f"{source}: sudden_quest는 스텝 2개 이상 필요 (스텝 전환 시점에 발동하므로)"
            )
        q_missing = {"npc", "task"} - quest.keys()
        if q_missing:
            raise ValueError(f"{source}: sudden_quest 필수 키 누락 {q_missing}")
        qt_missing = {"prompt", "criteria"} - quest["task"].keys()
        if qt_missing:
            raise ValueError(f"{source}: sudden_quest.task 필수 키 누락 {qt_missing}")
        npc_names = {n["name"] for n in doc["npcs"]}
        if quest["npc"] not in npc_names:
            raise ValueError(f"{source}: sudden_quest NPC '{quest['npc']}'의 페르소나 없음")


def load_scenarios() -> list[dict]:
    scenarios = []
    for filename, doc in _load_yaml_dir("scenarios"):
        validate_scenario(doc, f"data/scenarios/{filename}")
        scenarios.append(doc)
    return scenarios


def yaml_scenario_slugs() -> set[str]:
    """검수용 YAML이 소유한 slug — 변환 스크립트가 덮어쓰지 않도록."""
    return {doc["slug"] for _, doc in _load_yaml_dir("scenarios")}


def load_competencies() -> list[dict]:
    path = Path(settings.data_dir) / "evaluation" / "competencies.yaml"
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)["competencies"]
