"""게임 시나리오 slug → KB v5 직무군(family)의 doc_chunks job_code(J0xx) 매핑.

RAG 지식(kb-v5 청크)은 job_code가 J001~J103(KB v5 연구 체계)인데, 게임 시나리오/Job은
ys-01·cln-01 등이라 직접 매칭이 안 된다. 이 표로 slug → 해당 KB 직무군의 J코드들로 변환해
search_knowledge 스코프에 쓴다. 미매핑 slug(전문·기능·1차산업·법집행·R&D 등 KB 범위 밖)은
빈 리스트 → RAG 미주입(엉뚱한 지식 주입 방지).

매핑 근거: 2026-07-15 다중 에이전트 매칭+검수(45개 중 33개 확정, 12개 갭). 시나리오 제목과
KB family 이름의 의미 일치 기준. before/after 실검색으로 부활 검증 완료.
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

# 시나리오 slug → KB 직무군 (검증된 33건). 여기 없는 slug은 KB에 대응 직무 없음(갭).
_SLUG_TO_FAMILY = {
    # ys — 안전·정비 (ys-01 치안/ys-02 군사/ys-07 차량정비는 KB에 없어 갭)
    "ys-03": "F23", "ys-04": "F23", "ys-05": "F23",
    "ys-06": "F22", "ys-08": "F22", "ys-09": "F22", "ys-10": "F22",
    # kts — 대인응대
    "kts-01": "F12", "kts-02": "F13", "kts-03": "F11", "kts-04": "F10", "kts-05": "F12",
    # jm — 운송 (jm-02~05 철도·항공·해상·중장비는 KB에 없어 갭)
    "jm-01": "F24",
    # ms — 사무·현장 (ms-06 농축산/ms-08 생활서비스/ms-10 건설시공은 갭)
    "ms-01": "F01", "ms-02": "F02", "ms-03": "F01", "ms-04": "F04",
    "ms-05": "F19", "ms-07": "F20", "ms-09": "F19",
    # stn — 마케팅·기획 (stn-04 과학·기술조사는 갭)
    "stn-01": "F06", "stn-02": "F08", "stn-03": "F09", "stn-05": "F08",
    # yg — 디자인·개발 (yg-02 순수예술·공예는 갭)
    "yg-01": "F14", "yg-03": "F16", "yg-04": "F17", "yg-05": "F15",
    # 기타
    "cln-01": "F21", "gm-01": "F03", "hr-01": "F05", "sns-01": "F07", "wh-01": "F18",
}


def kb_jobs_for(slug: str) -> list[str]:
    """시나리오 slug → RAG 검색용 KB job_code 리스트. 미매핑이면 빈 리스트(RAG 미주입)."""
    fam = _SLUG_TO_FAMILY.get(slug)
    return list(_FAMILY_JOBS[fam]) if fam else []
