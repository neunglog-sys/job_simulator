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
        jobs.append(doc)
    return jobs


def load_scenarios() -> list[dict]:
    scenarios = []
    for filename, doc in _load_yaml_dir("scenarios"):
        missing = REQUIRED_SCENARIO_KEYS - doc.keys()
        if missing:
            raise ValueError(f"data/scenarios/{filename}: 필수 키 누락 {missing}")
        step_ids = {s["id"] for s in doc["steps"]}
        for step in doc["steps"]:
            for tr in step.get("transitions", []):
                if tr["to"] not in step_ids:
                    raise ValueError(
                        f"data/scenarios/{filename}: step '{step['id']}'의 전이 대상 "
                        f"'{tr['to']}'가 존재하지 않음"
                    )
            task = step.get("task")
            if task:
                missing = {"prompt", "criteria", "on_pass"} - task.keys()
                if missing:
                    raise ValueError(
                        f"data/scenarios/{filename}: step '{step['id']}' task 필수 키 누락 {missing}"
                    )
                if task["on_pass"] != "__end__" and task["on_pass"] not in step_ids:
                    raise ValueError(
                        f"data/scenarios/{filename}: step '{step['id']}'의 on_pass "
                        f"'{task['on_pass']}'가 존재하지 않음"
                    )
        scenarios.append(doc)
    return scenarios


def load_competencies() -> list[dict]:
    path = Path(settings.data_dir) / "evaluation" / "competencies.yaml"
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)["competencies"]
