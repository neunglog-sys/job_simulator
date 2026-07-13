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


# 룰(결정적) 채점 과제 종류의 단일 정의처 — scoring.grade_structured가 여기서 임포트.
# (content/loader는 app.core.config만 의존하는 경량 모듈이라 순환 없음)
RULE_KINDS = {"choice", "checklist", "order"}


def _validate_task(task: dict, where: str) -> None:
    """과제 공통 검증 — 선택·배열형(kind)은 보기(options)·정답(answer) 정합성까지."""
    kind = task.get("kind", "write")
    if kind == "write":
        return
    if kind not in RULE_KINDS:
        raise ValueError(f"{where}: 알 수 없는 task kind '{kind}'")
    options = task.get("options") or []
    keys = [o.get("key") for o in options]
    if len(options) < 2 or len(set(keys)) != len(keys):
        raise ValueError(f"{where}: {kind} 과제는 중복 없는 보기 2개 이상 필요")
    answer = task.get("answer") or {}
    if kind == "choice":
        answer_keys = [answer["key"]] if "key" in answer else []
    else:
        answer_keys = list(answer.get("keys") or [])
    if not answer_keys:
        raise ValueError(f"{where}: {kind} 과제에 정답(answer) 누락")
    if kind == "order" and len(answer_keys) < 2:
        # 항목 1개짜리 배열은 비교쌍이 없어 채점이 항상 0점 — 손편집 실수를 로드 시점에 차단
        raise ValueError(f"{where}: order 과제는 정답 항목 2개 이상 필요")
    bad = [k for k in answer_keys if k not in set(keys)]
    if bad:
        raise ValueError(f"{where}: 정답 키가 보기에 없음 {bad}")


def validate_scenario(doc: dict, source: str) -> None:
    """시나리오 문서 구조 검증 — YAML 시드와 변환 스크립트(build_scenarios) 공용."""
    missing = REQUIRED_SCENARIO_KEYS - doc.keys()
    if missing:
        raise ValueError(f"{source}: 필수 키 누락 {missing}")
    step_ids = {s["id"] for s in doc["steps"]}
    npc_names = {n["name"] for n in doc.get("npcs", [])}
    for step in doc["steps"]:
        # 엔진이 하드 인덱싱하는 키 — 없으면 런타임에 KeyError로 500 나므로 로드 시점에 차단
        step_missing = {"id", "title", "mission"} - step.keys()
        if step_missing:
            raise ValueError(f"{source}: step '{step.get('id', '?')}' 필수 키 누락 {step_missing}")
        # 스텝 NPC는 페르소나 목록에 있어야 대화 가능 — 손편집 rename 시 404 dead-end 방지
        bad_npcs = [n for n in step.get("npcs", []) if n not in npc_names]
        if bad_npcs:
            raise ValueError(f"{source}: step '{step['id']}'의 NPC {bad_npcs}의 페르소나 없음")
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
            _validate_task(task, f"{source}: step '{step['id']}'")
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
        _validate_task(quest["task"], f"{source}: sudden_quest")
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


def load_job_scenario_map() -> dict[str, str]:
    """추천 직무 code → 체험 시나리오 slug (map_jobs_to_scenarios 방출본, 사람 검수 우선).

    파일이 없으면 빈 dict — 추천은 정상 동작하고 '바로 체험' 연결만 빠진다.
    값이 null인 항목(체험 미연결 확정)은 걸러낸다.
    """
    path = Path(settings.data_dir) / "recommendation" / "job_scenario_map.yaml"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return {str(k): str(v) for k, v in raw.items() if v}
