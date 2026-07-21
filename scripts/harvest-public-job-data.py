"""공공데이터 API(고용24 등)를 호출해 data/knowledge/<직무코드>/ 에 근거자료 md를 생성한다.

⚠️ 2026-07-22 — WORK24_API_KEY 발급 포기함. 고용24 채용정보 신청서가 단일 양식인데,
채용정보목록/상세(이 스크립트가 쓰는 API)는 개인회원 이용 불가 — 민간 직업소개·직업정보
제공 사업자만 가능(사업자등록증+직업정보제공사업신고확인증 필요, 해커톤 팀에 없음).
코드는 참고용으로 남겨둠(팀이 나중에 사업자 등록 후 재도전할 경우 대비) — 지금은 실행 안 함.

RAG 적재 파이프라인(app/content/knowledge.py)은 이 폴더의 파일을 그대로 읽어 임베딩하므로,
이 스크립트는 파일만 만들고 끝난다 — `docker compose restart api` 하면 자동 반영.

필요 키: .env의 WORK24_API_KEY (고용24 마이페이지 > OPEN API 에서 발급, 회원가입 필요).
키가 없으면 --dry-run 없이는 실행을 거부한다(실제 호출 없이 만든 마크다운이 진짜 자료처럼
섞여 들어가는 걸 막기 위함 — data/knowledge/README.md의 "출처 명시" 원칙과 충돌하므로).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from xml.etree import ElementTree

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_DIR = ROOT / "data" / "knowledge"

WORK24_WANTED_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do"
WORK24_NCS_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo215L01.do"


def _work24_api_key() -> str:
    import os

    key = os.environ.get("WORK24_API_KEY")
    if key:
        return key
    return dotenv_values(ROOT / ".env").get("WORK24_API_KEY") or ""


async def fetch_work24_postings(keyword: str, api_key: str, display: int = 10) -> list[dict]:
    """고용24 채용정보(wantedApi.do) — 실시간 채용공고 검색.

    확인된 요청 형식: authKey + callTp=L(목록) + returnType=XML + keyword.
    """
    params = {
        "authKey": api_key,
        "callTp": "L",
        "returnType": "XML",
        "startPage": "1",
        "display": str(display),
        "keyword": keyword,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(WORK24_WANTED_URL, params=params)
        res.raise_for_status()
    root = ElementTree.fromstring(res.content)
    postings = []
    for item in root.iter("wanted"):
        postings.append(
            {
                "title": (item.findtext("title") or "").strip(),
                "company": (item.findtext("company") or "").strip(),
                "salary": (item.findtext("salTpNm") or "").strip(),
                "region": (item.findtext("region") or "").strip(),
                "career": (item.findtext("career") or "").strip(),
                "wanted_auth_no": (item.findtext("wantedAuthNo") or "").strip(),
            }
        )
    if not postings:
        # HTTP 200이어도 인증키 오류·쿼터초과면 <wanted> 없이 다른 에러 구조로 옴 —
        # 빈 결과로 조용히 넘어가면 인증 실패를 "검색 결과 없음"으로 착각하게 되므로 원본을 보여준다.
        print(f"[경고] 0건 응답 — 원본: {res.text[:500]}", file=sys.stderr)
    return postings


WORK24_ATTRIBUTION = (
    "정보출처 고용24 — 본 자료는 고용노동부 고용24(www.work24.go.kr)에서 제공된 정보이며, "
    "무단복제 및 배포를 금지합니다."
)


async def fetch_ncs_job_description(job_cont: str, api_key: str, limit: int = 10) -> list[dict]:
    """NCS 표준직무기술서(직무데이터사전) API — JSON 응답.

    응답의 정확한 키 이름은 실제 호출 전엔 미확인(문서에 파라미터만 명시, 출력 스키마는
    비공개) — 그래서 알려진 후보 키들을 순서대로 시도하고, 못 찾으면 원본 JSON 구조를
    그대로 반환해 최소한 무엇이 왔는지는 보이게 한다.
    """
    params = {
        "authKey": api_key,
        "jobCont": job_cont,
        "limit": str(limit),
        "returnType": "JSON",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(WORK24_NCS_URL, params=params)
        res.raise_for_status()
    data = res.json()
    for key in ("ncsList", "result", "list", "items"):
        if isinstance(data, dict) and key in data:
            found = data[key]
            entries = found if isinstance(found, list) else [found]
            break
    else:
        entries = data if isinstance(data, list) else [data]
    if not entries or (len(entries) == 1 and entries[0] == data and isinstance(data, dict)):
        # 후보 키 어디에도 안 걸리면 에러 응답을 그대로 감쌌을 가능성이 커서 알려준다.
        print(f"[경고] NCS 응답에서 목록 키를 못 찾음 — 원본: {json.dumps(data, ensure_ascii=False)[:500]}", file=sys.stderr)
    return entries


def ncs_to_markdown(job_cont: str, entries: list[dict]) -> str:
    lines = [f"# {job_cont} — NCS 표준직무기술서(직무데이터사전)", ""]
    if not entries:
        lines.append("_검색 결과 없음_")
    for e in entries:
        lines.append("```json")
        lines.append(json.dumps(e, ensure_ascii=False, indent=2))
        lines.append("```")
        lines.append("")
    lines.append("---")
    lines.append(
        f"출처: 고용24(워크넷) 직무데이터사전 Open API, jobCont=`{job_cont}` "
        "(응답 스키마 미확정 — 실제 응답 보고 위 파싱을 다듬을 것)"
    )
    return "\n".join(lines)


def postings_to_markdown(job_code: str, keyword: str, postings: list[dict]) -> str:
    lines = [f"# {keyword} 채용 동향 (고용24 실시간 검색)", ""]
    if not postings:
        lines.append("_검색 결과 없음_")
    for p in postings:
        lines.append(f"## {p['title']} — {p['company']}")
        lines.append(f"- 지역: {p['region'] or '미기재'} / 경력: {p['career'] or '미기재'} / 급여: {p['salary'] or '미기재'}")
        if p["wanted_auth_no"]:
            lines.append(
                f"- 원문: https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do"
                f"?wantedAuthNo={p['wanted_auth_no']}&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet"
            )
        lines.append("")
    lines.append("---")
    lines.append(f"검색 조건: keyword=`{keyword}`, 검색 시점 기준 실시간 스냅샷")
    lines.append(WORK24_ATTRIBUTION)
    return "\n".join(lines)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-code", required=True, help="data/jobs/*.yaml의 code (예: backend-developer)")
    parser.add_argument("--keyword", required=True, help="고용24 검색 키워드 (예: 백엔드 개발자)")
    parser.add_argument("--ncs-job-cont", help="NCS 직무데이터사전 조회용 수행직무내용 (생략하면 NCS 조회 건너뜀)")
    parser.add_argument("--display", type=int, default=10, help="가져올 공고 수 (기본 10)")
    parser.add_argument("--dry-run", action="store_true", help="API 호출 없이 요청 계획만 출력")
    args = parser.parse_args()

    api_key = _work24_api_key()
    if args.dry_run:
        print(f"[dry-run] GET {WORK24_WANTED_URL} keyword={args.keyword!r} display={args.display}")
        print(f"[dry-run] 저장 위치: data/knowledge/{args.job_code}/work24_postings.md")
        if args.ncs_job_cont:
            print(f"[dry-run] GET {WORK24_NCS_URL} jobCont={args.ncs_job_cont!r}")
            print(f"[dry-run] 저장 위치: data/knowledge/{args.job_code}/ncs_description.md")
        print(f"[dry-run] WORK24_API_KEY {'설정됨' if api_key else '미설정 (.env에 추가 필요)'}")
        return 0

    if not api_key:
        print(
            "WORK24_API_KEY가 없습니다. .env에 키를 넣거나 --dry-run으로 먼저 확인하세요.\n"
            "발급: https://www.work24.go.kr 회원가입 후 마이페이지 > OPEN API",
            file=sys.stderr,
        )
        return 1

    out_dir = KNOWLEDGE_DIR / args.job_code
    out_dir.mkdir(parents=True, exist_ok=True)

    postings = await fetch_work24_postings(args.keyword, api_key, args.display)
    out_path = out_dir / "work24_postings.md"
    out_path.write_text(postings_to_markdown(args.job_code, args.keyword, postings), encoding="utf-8")
    print(f"채용공고 {len(postings)}건 저장: {out_path.relative_to(ROOT)}")

    if args.ncs_job_cont:
        entries = await fetch_ncs_job_description(args.ncs_job_cont, api_key)
        ncs_path = out_dir / "ncs_description.md"
        ncs_path.write_text(ncs_to_markdown(args.ncs_job_cont, entries), encoding="utf-8")
        print(f"NCS 항목 {len(entries)}건 저장: {ncs_path.relative_to(ROOT)}")

    print("반영하려면: docker compose restart api")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
