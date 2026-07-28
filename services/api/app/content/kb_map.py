"""게임 시나리오 slug → RAG 검색 스코프(doc_chunks job_code 목록) 매핑.

RAG 지식(kb-v5 청크)은 job_code가 J001~J103(KB v5 연구 체계)인데, 게임 시나리오/Job은
ys-01·cln-01 등이라 직접 매칭이 안 된다. 이 표로 slug → 해당 KB 직무군의 J코드들로 변환해
search_knowledge 스코프에 쓴다.

스코프에는 slug 자체도 항상 포함한다 — KB에 없는 직무(철도·항공·군사 등 12개 갭)는
data/knowledge/<slug>/*.md 로 보충 지식을 적재하며(job_code=폴더명=slug), 매핑된 직무도
전용 지식을 추가하면 함께 검색된다. 전용 지식이 없는 slug은 검색 0건 → 미주입(안전).

매핑 근거: 2026-07-15 다중 에이전트 매칭+검수(45개 중 33개 확정, 12개 갭은 전용 지식으로
보충). before/after 실검색으로 부활 검증 완료.
"""


def _jobs(a: int, b: int) -> list[str]:
    return [f"J{i:03d}" for i in range(a, b + 1)]


# KB v5 family_id → 그 직무군의 doc_chunks job_code 목록 (kb_jobs 기준 범위)
_FAMILY_JOBS = {
    "F01": _jobs(1, 5), "F02": _jobs(6, 10), "F03": _jobs(11, 14), "F04": _jobs(15, 19),
    "F05": _jobs(20, 24), "F06": _jobs(25, 29), "F07": _jobs(30, 33), "F08": _jobs(34, 38),
    "F09": _jobs(39, 43), "F10": _jobs(44, 48), "F11": _jobs(49, 53), "F12": _jobs(54, 57),
    "F13": _jobs(58, 61), "F14": _jobs(62, 66), "F15": _jobs(67, 69), "F16": _jobs(70, 74),
    "F17": _jobs(75, 79), "F18": _jobs(80, 83), "F19": _jobs(84, 87), "F20": _jobs(88, 90),
    "F21": _jobs(91, 93), "F22": _jobs(94, 97), "F23": _jobs(98, 100), "F24": _jobs(101, 103),
}

# 시나리오 slug → KB 직무군 (활성 시나리오 26건). 여기 없는 slug은 KB에 대응 직무 없음(갭)
# 이며, 갭은 data/knowledge/<slug>/*.md 전용 지식으로 보충한다.
#
# ⚠️ 활성 시나리오(data/scenarios/*.yaml)만 둔다 — 비활성(_disabled)으로 내린 slug을
# 남겨두면 검색에는 안 쓰이지만(그 slug로 요청이 안 옴) 지식 커버리지 지표의 분모가
# 오염된다("매핑 40건 vs 활성 37건"처럼 계산이 어긋남). 2026-07-27 F 개편에서
# 비활성화된 ms-01·ms-05·stn-02·ys-06·ys-08·ys-10과 기존 yg-05를 제거했다.
_SLUG_TO_FAMILY = {
    # ys — 안전·정비 (ys-01 치안/ys-02 군사는 KB에 없어 갭)
    "ys-03": "F23", "ys-04": "F23", "ys-05": "F23", "ys-09": "F22",
    # kts — 대인응대
    "kts-01": "F12", "kts-02": "F13", "kts-03": "F11", "kts-04": "F10", "kts-05": "F12",
    # jm — 운송 (jm-02~05 철도·항공·해상·중장비는 KB에 없어 갭)
    "jm-01": "F24",
    # ms — 사무·현장 (ms-06 농축산/ms-08 생활서비스/ms-10 건설시공은 갭)
    "ms-02": "F02", "ms-03": "F01", "ms-04": "F04", "ms-07": "F20", "ms-09": "F19",
    # stn — 마케팅·기획 (stn-04 과학·기술조사는 갭)
    "stn-01": "F06", "stn-03": "F09", "stn-05": "F08",
    # yg — 디자인·개발 (yg-02 순수예술·공예는 갭)
    "yg-01": "F14", "yg-03": "F16", "yg-04": "F17",
    # 기타
    "cln-01": "F21", "gm-01": "F03", "hr-01": "F05", "sns-01": "F07", "wh-01": "F18",
}


def kb_jobs_for(slug: str) -> list[str]:
    """시나리오 slug → RAG 검색 스코프 job_code 리스트.

    slug 자체(data/knowledge/<slug>/ 전용 지식) + KB 매핑이 있으면 그 직무군 J코드들.
    """
    fam = _SLUG_TO_FAMILY.get(slug)
    return [slug] + (list(_FAMILY_JOBS[fam]) if fam else [])
