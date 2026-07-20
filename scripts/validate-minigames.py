"""4단계 미니게임 데이터 기계 검증 — data/minigames/*.yaml 전수 검사.

검사 항목 (구조·정합성 — 내용 검증은 사람/에이전트 몫):
  1. YAML 파싱 가능
  2. 필수 키: scenario_id, engine, data
  3. scenario_id == 파일명 (짝 어긋남 방지)
  4. engine이 백엔드 MINIGAME_COMPETENCY 등록 키인가 (아니면 점수가 조용히 버려진다)
  5. 짝 시나리오(data/scenarios/<slug>.yaml)가 실제로 존재하는가
  6. 엔진별 data 필수 필드 + 함정(decoys/extras/forbidden/unmatched/...) 존재
  7. 좌표(at)가 논리 캔버스(960x440) 안인가
  8. typing 예외 전제: count_speed가 true면 실패 (속도 미채점 — 팀 확정 2026-07-20)

사용: python scripts/validate-minigames.py  (API 컨테이너 안에서는 /app 기준 자동)
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

# 백엔드와 동일한 등록 엔진 목록 — aggregate.py의 MINIGAME_COMPETENCY와 맞춘다.
# (스크립트 단독 실행을 위해 하드코딩하되, 컨테이너 안이면 실제 모듈과 대조한다)
ENGINES = {
    "spot", "gauge", "sort", "match", "route",
    "sequence", "pour", "trace", "physics", "place", "typing",
}

SCENE_W, SCENE_H = 960, 440

# 엔진별: (필수 data 필드들, 함정으로 인정할 필드 후보)
ENGINE_RULES: dict[str, tuple[set[str], set[str]]] = {
    "spot":     ({"targets"}, {"decoys"}),
    "gauge":    ({"gauges"}, {"gauges"}),          # 함정 = 정상 게이지 혼재 (아래 별도 검사)
    "sort":     ({"bins", "items"}, {"items", "escalate"}),
    "match":    ({"left", "right", "pairs"}, {"unmatched", "forbidden_pairs"}),
    "route":    ({"start"}, {"avoid"}),
    "sequence": ({"steps"}, {"forbidden"}),
    "pour":     ({"vessels"}, {"vessels"}),        # 함정 = tolerance (정밀 요구)
    "trace":    ({"guide"}, {"interrupts"}),
    "physics":  ({"mode"}, set()),                 # 모드별 아래 별도 검사
    "place":    ({"slots", "pieces"}, {"extras"}),
    "typing":   ({"lines"}, {"distractors"}),
}


def find_base() -> Path:
    for cand in (Path("data"), Path("/app/data")):
        if (cand / "minigames").is_dir():
            return cand
    sys.exit("data/minigames 를 찾을 수 없음 — 저장소 루트에서 실행하세요")


def _ids_of(seq: object) -> set[str]:
    """[{id:..}] 또는 [문자열] 목록에서 id 집합 추출."""
    out: set[str] = set()
    if isinstance(seq, list):
        for item in seq:
            if isinstance(item, dict) and item.get("id"):
                out.add(str(item["id"]))
            elif isinstance(item, str):
                out.add(item)
    return out


def check_cross_refs(engine: str, data: dict, errors: list[str], warnings: list[str], name: str) -> None:
    """참조 무결성 — ys-03류(escalate.when이 유령 id) 실수를 기계로 차단한다.

    검증 워크플로가 확정한 실패 유형의 기계화:
      · match: pairs의 모든 id가 left/right에 실재해야 하고, unmatched도 실재해야 함
      · sort:  items의 bin이 bins에 실재해야 함 (escalate: true 항목은 bin 면제)
      · escalate.when/requires: 실재하는 항목·통·스텝 id만 가리켜야 함
      · gauge: fail 라벨에 정답을 유출하는 접미(과열·경보·이상 등)가 붙으면 경고
      · route: 최대 avoid penalty가 (100−pass_score) 이하면 '밟고도 합격' 경고
    """
    if engine == "match":
        left = _ids_of(data.get("left"))
        right = _ids_of(data.get("right"))
        both = left | right
        for pair in data.get("pairs") or []:
            if isinstance(pair, list):
                for pid in pair:
                    if pid not in both:
                        errors.append(f"{name}: pairs의 '{pid}' 가 left/right에 없음")
        for uid in data.get("unmatched") or []:
            if uid not in both:
                errors.append(f"{name}: unmatched의 '{uid}' 가 left/right에 없음")
        for fp in data.get("forbidden_pairs") or []:
            ids = fp if isinstance(fp, list) else (fp.get("pair") if isinstance(fp, dict) else None)
            if isinstance(ids, list):
                for pid in ids:
                    if pid not in both:
                        errors.append(f"{name}: forbidden_pairs의 '{pid}' 가 left/right에 없음")

    if engine == "sort":
        bins = _ids_of(data.get("bins"))
        for item in data.get("items") or []:
            if not isinstance(item, dict):
                continue
            b = item.get("bin")
            if b is None:
                if not item.get("escalate"):
                    warnings.append(f"{name}: item '{item.get('id')}' 에 bin도 escalate도 없음 — 정답 미정의")
            elif b not in bins:
                errors.append(f"{name}: item '{item.get('id')}' 의 bin '{b}' 가 bins에 없음")

    # escalate 참조 — when/requires가 유령 id를 가리키면 엔진이 바인딩 못 한다
    esc = data.get("escalate")
    if isinstance(esc, dict):
        known = (
            _ids_of(data.get("items")) | _ids_of(data.get("left")) | _ids_of(data.get("right"))
            | _ids_of(data.get("targets")) | _ids_of(data.get("gauges")) | _ids_of(data.get("steps"))
            | _ids_of(data.get("bins")) | _ids_of(data.get("pieces")) | _ids_of(data.get("stages"))
        )
        # 돌발(sudden) 블록 안의 id·stages 도 참조 대상이다 (kts류 구조)
        sudden = data.get("sudden")
        if isinstance(sudden, dict):
            if sudden.get("id"):
                known.add(str(sudden["id"]))
            known |= _ids_of(sudden.get("stages"))
        when = esc.get("when")
        whens = when if isinstance(when, list) else ([when] if when else [])
        # 상태 조건('_발생'/'_지속'으로 끝남)은 항목 참조가 아니다 — sudden.persists_after_stages
        # 같은 정의가 파일에 있으면 성립한다(_SCHEMA.md escalate 규약).
        condition_suffixes = ("_발생", "_지속")
        for w in whens:
            if known and w not in known and not str(w).endswith(condition_suffixes):
                errors.append(f"{name}: escalate.when '{w}' 이 어떤 항목 id와도 일치하지 않음")
        for req in esc.get("requires") or []:
            if known and req not in known:
                warnings.append(f"{name}: escalate.requires '{req}' 가 항목 id에 없음 — 단계명이면 stages에 정의할 것")

    if engine == "gauge":
        leak_words = ("과열", "경보", "이상", "고장", "누유", "파손", "℃", "미달")
        for g in data.get("gauges") or []:
            if isinstance(g, dict) and g.get("verdict") == "fail":
                label = str(g.get("label") or "")
                hits = [w for w in leak_words if w in label]
                if hits:
                    errors.append(f"{name}: fail 게이지 '{g.get('id')}' 라벨이 정답 유출 {hits} — 바늘로만 판별해야 함")

    if engine == "route":
        # report_at 은 실재 노드여야 한다 (yg-04 유령 참조 유형 — 2차 검증에서 확정)
        report = data.get("report_at")
        if report:
            nodes = _ids_of(data.get("waypoints")) | {
                str(s.get("at")) for s in data.get("signals") or [] if isinstance(s, dict)
            }
            start = data.get("start")
            if isinstance(start, dict) and start.get("id"):
                nodes.add(str(start["id"]))
            elif isinstance(start, str):
                nodes.add(start)
            # waypoints 가 문자열 목록인 경우도 커버
            for w in data.get("waypoints") or []:
                if isinstance(w, str):
                    nodes.add(w)
            if str(report) not in nodes:
                errors.append(f"{name}: report_at '{report}' 가 실재 노드(waypoints/start/signals)에 없음")
        pens = [a.get("penalty", 0) for a in data.get("avoid") or [] if isinstance(a, dict)]
        if pens:
            # pass_score는 doc 레벨이라 여기선 70 가정(전 파일 공통) — 위반하고도 합격하면 경고
            slack = 100 - 70
            soft = [p for p in pens if p <= slack]
            if soft and max(pens) <= slack:
                warnings.append(f"{name}: 모든 avoid penalty({pens})가 {slack} 이하 — 최악 위반 1회로도 합격 가능. 금지행동 구역은 40↑ 권장")


def walk_coords(node: object, path: str, errors: list[str], fname: str) -> None:
    """at:[x,y] 좌표가 논리 캔버스 밖이면 화면 밖에 그려진다 — 재귀 수집."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "at" and isinstance(v, list) and len(v) == 2 \
                    and all(isinstance(c, (int, float)) for c in v):
                x, y = v
                if not (0 <= x <= SCENE_W and 0 <= y <= SCENE_H):
                    errors.append(f"{fname}: {path}.at=[{x},{y}] 가 캔버스(960x440) 밖")
            else:
                walk_coords(v, f"{path}.{k}", errors, fname)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            walk_coords(item, f"{path}[{i}]", errors, fname)


def main() -> None:
    base = find_base()
    mg_dir = base / "minigames"
    sc_dir = base / "scenarios"

    # 컨테이너 안이면 실제 백엔드 등록 키와 대조 (드리프트 감지)
    engines = set(ENGINES)
    try:
        sys.path.insert(0, "/app")
        from app.domains.scoring.aggregate import MINIGAME_COMPETENCY  # type: ignore
        backend = set(MINIGAME_COMPETENCY)
        if backend != engines:
            print(f"⚠ 스크립트 엔진 목록이 백엔드와 다름: "
                  f"스크립트에만={engines - backend} 백엔드에만={backend - engines}")
            engines = backend
    except ImportError:
        pass

    errors: list[str] = []
    warnings: list[str] = []
    files = sorted(mg_dir.glob("*.yaml"))

    for f in files:
        name = f.name
        slug = f.stem
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            errors.append(f"{name}: YAML 파싱 실패 — {e}")
            continue
        if not isinstance(doc, dict):
            errors.append(f"{name}: 최상위가 매핑이 아님")
            continue

        # 필수 키 + scenario_id 일치
        for key in ("scenario_id", "engine", "data"):
            if key not in doc:
                errors.append(f"{name}: 필수 키 '{key}' 누락")
        sid = doc.get("scenario_id")
        if sid and sid != slug:
            errors.append(f"{name}: scenario_id '{sid}' 가 파일명과 다름")

        # 짝 시나리오 존재
        if not (sc_dir / f"{slug}.yaml").exists():
            errors.append(f"{name}: 짝 시나리오 data/scenarios/{slug}.yaml 없음")

        engine = str(doc.get("engine") or "")
        if engine not in engines:
            errors.append(f"{name}: engine '{engine}' 미등록 — 점수가 조용히 버려짐 "
                          f"(사용 가능: {', '.join(sorted(engines))})")
            continue

        data = doc.get("data")
        if not isinstance(data, dict):
            continue  # 위에서 이미 보고됨

        required, trap_fields = ENGINE_RULES[engine]
        missing = required - data.keys()
        if missing:
            errors.append(f"{name}: {engine} 필수 data 필드 누락 {sorted(missing)}")

        # 함정 검사 — 엔진별 의미가 달라 개별 판단
        if engine == "spot" and not data.get("decoys"):
            errors.append(f"{name}: spot에 decoys 없음 — 다 누르면 만점")
        elif engine == "gauge":
            gauges = data.get("gauges") or []
            verdicts = {str(g.get("verdict")) for g in gauges if isinstance(g, dict)}
            if verdicts and len(verdicts) < 2:
                errors.append(f"{name}: gauge 판정이 한 종류뿐({verdicts}) — 변별력 없음")
        elif engine == "sort":
            bins = data.get("bins") or []
            if isinstance(bins, list) and len(bins) < 2:
                errors.append(f"{name}: sort 통이 {len(bins)}개 — 분류가 성립 안 함")
        elif engine == "match" and not (data.get("unmatched") or data.get("forbidden_pairs")):
            warnings.append(f"{name}: match에 unmatched/forbidden_pairs 없음 — 전부 이으면 만점")
        elif engine == "sequence" and not data.get("forbidden"):
            warnings.append(f"{name}: sequence에 forbidden 없음 — 금지행동 표현 확인 필요")
        elif engine == "route" and not data.get("avoid"):
            warnings.append(f"{name}: route에 avoid 없음 — 아무 길이나 가도 만점")
        elif engine == "trace" and not (
            data.get("interrupts") or data.get("emergency") or data.get("terminal_stop")
        ):
            warnings.append(f"{name}: trace에 interrupts/emergency/terminal_stop 없음 — 정지 판단 요소 없음")
        elif engine == "place" and not data.get("extras"):
            warnings.append(f"{name}: place에 extras 없음 — 전부 배치하면 만점")
        elif engine == "physics":
            mode = data.get("mode")
            if mode not in ("rhythm", "balance"):
                errors.append(f"{name}: physics mode '{mode}' — rhythm|balance 여야 함")
            elif mode == "rhythm" and not data.get("beats"):
                errors.append(f"{name}: physics rhythm에 beats 없음")
            elif mode == "balance" and "target" not in data and "drift" not in data:
                warnings.append(f"{name}: physics balance에 target/drift 없음 — 난이도 정의 확인")
        elif engine == "typing":
            if not data.get("distractors"):
                errors.append(f"{name}: typing에 distractors 없음 — 전부 치면 만점")
            if (doc.get("scoring") or {}).get("count_speed") is True:
                errors.append(f"{name}: count_speed=true — 속도 미채점이 팀 확정(2026-07-20)")

        check_cross_refs(engine, data, errors, warnings, name)
        walk_coords(data, "data", errors, name)

        # escalate(보고·호출)가 있으면 방치 감점이 정의돼야 한다 — 무감점 방치는
        # '원문 정답 행동이 무비용'이 되는 유형 (2차 검증에서 다수 확정)
        scoring = doc.get("scoring") or {}
        has_escalate = isinstance(data.get("escalate"), dict) or any(
            isinstance(i, dict) and i.get("escalate") for i in data.get("items") or []
        )
        if has_escalate and not any(
            k in scoring for k in ("missed_escalate_penalty", "escalate_missed_penalty", "escalate_required")
        ):
            warnings.append(f"{name}: escalate 는 있는데 방치 감점(missed_escalate_penalty)이 없음 — 무시가 무비용")

        # 표준 채점 키 강제 — 변형 키는 엔진이 못 읽는다 (_SCHEMA.md 표준 채점 키)
        nonstandard = {
            "wrong_plug_penalty": "wrong_slot_penalty", "misplace_penalty": "wrong_slot_penalty",
            "misclassify_penalty": "wrong_bin_penalty", "wrong_link_penalty": "wrong_pair_penalty",
        }
        for bad, good in nonstandard.items():
            if bad in scoring:
                warnings.append(f"{name}: 비표준 채점 키 '{bad}' → '{good}' 로 통일할 것")

    # 커버리지: 활성 시나리오 전부에 게임이 있는가
    active = {p.stem for p in sc_dir.glob("*.yaml")}
    covered = {p.stem for p in files}
    uncovered = active - covered
    orphans = covered - active

    print(f"파일 {len(files)}개 검사 — 활성 시나리오 {len(active)}개 중 {len(covered & active)}개 커버")
    if uncovered:
        print(f"  게임 없는 시나리오 ({len(uncovered)}): {', '.join(sorted(uncovered))}")
    if orphans:
        errors.append(f"고아 게임(짝 시나리오 없음): {sorted(orphans)}")

    for w in warnings:
        print(f"  ⚠ {w}")
    if errors:
        print(f"\n오류 {len(errors)}건:")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    print(f"\n오류 0건 (경고 {len(warnings)}건)")


if __name__ == "__main__":
    main()
