"""data/ 폴더의 YAML 콘텐츠 로더."""

import logging
from pathlib import Path

import yaml

from app.core.config import settings
from app.core.state_keys import ENGINE_STATE_KEYS

logger = logging.getLogger(__name__)


def read_yaml_map(path: Path) -> dict[str, str]:
    """선택적 매핑 YAML → {str: str}. null 값은 걸러낸다.

    없거나 깨진 파일은 빈 dict — 콘텐츠 파일 오류가 API 응답을 500으로 브릭하지 않게
    (엔드포인트는 매핑이 빠진 것처럼 동작하고, 원인은 로그로 남긴다).
    """
    if not path.exists():
        return {}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        logger.warning("매핑 YAML 파싱 실패 — 빈 매핑으로 동작: %s", path)
        return {}
    if not isinstance(raw, dict):
        logger.warning("매핑 YAML이 dict가 아님 — 빈 매핑으로 동작: %s", path)
        return {}
    return {str(k): str(v) for k, v in raw.items() if v}

REQUIRED_JOB_KEYS = {"code", "title", "description", "competencies"}
# NPC 실데이터는 data/npcs/*.yaml로 분리 — 시나리오엔 npc_id 참조만
REQUIRED_SCENARIO_KEYS = {"job", "slug", "title", "initial_state", "steps"}

# 배치1 조사 필드(education_requirement/salary/certifications/status)는 선택 필드 —
# docs/jobs/batch1_mapping_candidates.md 참고. 값이 있을 때만 아래 회귀 규칙을 검증한다.
VALID_JOB_STATUS = {"provisional", "team_review", "not_found", "cross_check_required"}


def _validate_job_research_fields(doc: dict, filename: str) -> None:
    """조사 데이터 회귀 검증.

    wagework.go.kr 수집 과정에서 확인된 두 가지 함정을 데이터 계층에서도 막는다:
    - status는 4개 값 외에는 오탈자로 간주.
    - reference_statistics가 존재하는데 median_annual_krw가 0/빈 값이면, "재직자
      조사 자체가 없음"(median 0)과 "조사는 있지만 값이 0"을 구분 못 한 것 —
      전자는 반드시 reference_statistics 전체를 null로 표기해야 한다.
    """
    status = doc.get("status")
    if status is not None and status not in VALID_JOB_STATUS:
        raise ValueError(f"data/jobs/{filename}: 알 수 없는 status '{status}'")

    salary = doc.get("salary")
    if salary:
        ref = salary.get("reference_statistics")
        if ref is not None and not ref.get("median_annual_krw"):
            raise ValueError(
                f"data/jobs/{filename}: reference_statistics가 있는데 "
                "median_annual_krw가 비어있음/0 — 상세조사 데이터 없음인 경우 "
                "reference_statistics 전체를 null로 표기해야 함"
            )


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
        doc.setdefault("dimension_weights", {})  # 선택 필드 — 8모듈 43축 가중치(카테고리 직무만)
        _validate_job_research_fields(doc, filename)
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


def validate_npcs(npc_ids: list[dict], source: str) -> set[str]:
    """NPC 엔트리 목록 검증 → npc_id 집합. data/npcs 파일과 build 내부 doc 공용."""
    ids = set()
    for n in npc_ids:
        n_missing = {"npc_id", "name", "role"} - n.keys()
        if n_missing:
            raise ValueError(f"{source}: npc '{n.get('npc_id', '?')}' 필수 키 누락 {n_missing}")
        if n["npc_id"] in ids:
            raise ValueError(f"{source}: 중복 npc_id '{n['npc_id']}'")
        ids.add(n["npc_id"])
    return ids


def validate_scenario(doc: dict, source: str, npc_ids: set[str]) -> None:
    """시나리오 구조 검증 — npc_ids는 짝 NPC 파일(또는 build 내부 doc)에서 온 유효 id 집합."""
    missing = REQUIRED_SCENARIO_KEYS - doc.keys()
    if missing:
        raise ValueError(f"{source}: 필수 키 누락 {missing}")
    step_ids = {s["id"] for s in doc["steps"]}
    for step in doc["steps"]:
        # 엔진이 하드 인덱싱하는 키 — 없으면 런타임에 KeyError로 500 나므로 로드 시점에 차단
        step_missing = {"id", "title", "mission"} - step.keys()
        if step_missing:
            raise ValueError(f"{source}: step '{step.get('id', '?')}' 필수 키 누락 {step_missing}")
        # 스텝 NPC는 npc_id로 로스터에 있어야 대화 가능 — 손편집 오참조 시 404 dead-end 방지
        bad_npcs = [n for n in step.get("npcs", []) if n not in npc_ids]
        if bad_npcs:
            raise ValueError(f"{source}: step '{step['id']}'의 NPC {bad_npcs}가 로스터에 없음")
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
    # 엔진 키 전체를 막는다. 세 개만 막고 있어서 minigame·coach_streak 같은 키를
    # 시나리오가 정의하면 엔진 상태를 덮어쓸 수 있었다.
    reserved = ENGINE_STATE_KEYS & set(doc.get("initial_state", {}))
    if reserved:
        raise ValueError(f"{source}: initial_state에 예약 키 사용 불가 {sorted(reserved)}")
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
        if quest["npc"] not in npc_ids:
            raise ValueError(f"{source}: sudden_quest NPC '{quest['npc']}'가 로스터에 없음")


def load_npcs() -> dict[str, list[dict]]:
    """data/npcs/*.yaml → {scenario_id: [npc, ...]} — NPC 실데이터의 단일 원본."""
    out: dict[str, list[dict]] = {}
    for filename, doc in _load_yaml_dir("npcs"):
        sid = doc.get("scenario_id")
        if not sid:
            raise ValueError(f"data/npcs/{filename}: scenario_id 누락")
        validate_npcs(doc.get("npcs", []), f"data/npcs/{filename}")
        out[sid] = doc.get("npcs", [])
    return out


def load_scenarios() -> tuple[list[dict], dict[str, list[dict]]]:
    """시나리오 + NPC를 짝지어 로드·교차검증 → (scenarios, {slug: npcs})."""
    npcs_by_slug = load_npcs()
    scenarios = []
    for filename, doc in _load_yaml_dir("scenarios"):
        slug = doc.get("slug")
        npcs = npcs_by_slug.get(slug, [])
        npc_ids = validate_npcs(npcs, f"data/npcs/{slug}.yaml")
        validate_scenario(doc, f"data/scenarios/{filename}", npc_ids)
        scenarios.append(doc)
    return scenarios, npcs_by_slug


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
    return read_yaml_map(Path(settings.data_dir) / "recommendation" / "job_scenario_map.yaml")
