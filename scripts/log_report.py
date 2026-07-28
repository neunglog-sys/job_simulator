#!/usr/bin/env python3
"""서버 로그 → 평가지표 요약 (VM에서 바로 실행).

시연·촬영 뒤 그 구간의 로그만 잘라 넣으면 지표가 한 화면으로 나온다.
표준 라이브러리만 쓰므로 VM에 별도 설치가 필요 없다.

사용:
    cd ~/job_simulator
    docker compose -f infra/docker-compose.yml logs --since 30m api | python3 scripts/log_report.py

    # 특정 구간만 (촬영 시각 기준)
    docker compose -f infra/docker-compose.yml logs --since 2h api | python3 scripts/log_report.py

    # 파일로 받아둔 로그
    python3 scripts/log_report.py < journey.log

읽는 로그(전부 코드가 남기는 것):
    상담 응답 구간   consultation/service.py  — 첫토큰·전체·RAG·지식 주입
    [LLM-USAGE]     llm/providers/gemini_provider.py — 토큰·비용(사고 포함)
    [HTTP-LATENCY]  main.py — 엔드포인트 응답시간
    [RELAY-TIMING]  avatar/service.py — 아바타 첫 프레임
    [TTS]           tts/service.py — 합성 문자수·폴백 단계
"""

import re
import sys
from collections import Counter, defaultdict

# ── 로그 패턴 ──────────────────────────────────────────────────────────
RE_CONSULT = re.compile(
    r"상담 응답 구간: rag ([\d.]+)ms\((\w+)\) · 첫토큰 ([\d.-]+)ms · 전체 ([\d.]+)ms"
    r" · 응답 (\d+)자\(제한 (\S+?)\) · system ([\d.]+)KB · 지식 (\S+)"
)
RE_USAGE = re.compile(
    r"\[LLM-USAGE\] api=(\w+) in=(\d+) out=(\d+) think=(\d+) total=(\d+) usd=([\d.]+)"
)
RE_TRUNC = re.compile(r"\[LLM-USAGE\] api=stream truncated=1")
RE_HTTP = re.compile(r"\[HTTP-LATENCY\] (\w+) (\S+) status=(\d+) ms=([\d.]+)")
RE_RELAY = re.compile(r"\[RELAY-TIMING\] rid=(\w+) first_binary .*first_binary_ms=([\d.]+)")
RE_TTS = re.compile(r"\[TTS\] provider=(\w+) chars=(\d+) voice=(\S+) elapsed_ms=([\d.]+)")
RE_EMBED_TO = re.compile(r"RAG 임베딩 [\d.]+s 초과")
RE_ERROR = re.compile(r"(ERROR|Traceback|미처리 예외)")

KRW = 1380  # 환율 — 원화 환산용(대략치)


def pct(values, p):
    """백분위 — 표본이 적어도 동작하게 최근접 순위법."""
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, round(p / 100 * len(s) + 0.5) - 1))
    return s[k]


def line(title=""):
    print(f"\n{'─' * 58}" if not title else f"\n── {title} " + "─" * max(0, 52 - len(title)))


def main() -> None:
    consult, usage, http, relay, tts = [], [], [], [], []
    trunc = embed_timeout = errors = 0

    for raw in sys.stdin:
        if m := RE_CONSULT.search(raw):
            consult.append({
                "rag_ms": float(m[1]), "reason": m[2], "ttft": float(m[3]),
                "total": float(m[4]), "chars": int(m[5]), "limit": m[6],
                "sys_kb": float(m[7]), "knowledge": m[8].strip(),
            })
        if m := RE_USAGE.search(raw):
            usage.append({"api": m[1], "in": int(m[2]), "out": int(m[3]),
                          "think": int(m[4]), "usd": float(m[6])})
        if RE_TRUNC.search(raw):
            trunc += 1
        if m := RE_HTTP.search(raw):
            http.append({"method": m[1], "path": m[2], "status": int(m[3]), "ms": float(m[4])})
        if m := RE_RELAY.search(raw):
            relay.append(float(m[2]))
        if m := RE_TTS.search(raw):
            tts.append({"provider": m[1], "chars": int(m[2]), "ms": float(m[4])})
        if RE_EMBED_TO.search(raw):
            embed_timeout += 1
        if RE_ERROR.search(raw):
            errors += 1

    print("=" * 58)
    print(" 서버 로그 요약")
    print("=" * 58)

    # ── 상담 ──
    if consult:
        line("상담 응답")
        ttft = [c["ttft"] for c in consult if c["ttft"] >= 0]
        tot = [c["total"] for c in consult]
        kb = sum(1 for c in consult if c["knowledge"] == "유")
        reasons = Counter(c["reason"] for c in consult)
        print(f"  턴 수            {len(consult)}")
        print(f"  첫 토큰          p50 {pct(ttft,50):>6.0f}ms · p95 {pct(ttft,95):>6.0f}ms")
        print(f"  전체 응답        p50 {pct(tot,50):>6.0f}ms · p95 {pct(tot,95):>6.0f}ms")
        print(f"  지식 주입률      {kb}/{len(consult)} ({kb*100//max(1,len(consult))}%)")
        print(f"  RAG 실행 사유    " + " · ".join(f"{k} {v}" for k, v in reasons.most_common()))
        if embed_timeout:
            print(f"  ⚠️ 임베딩 타임아웃 {embed_timeout}건 — 2초 쓰고 지식 0건으로 진행")
        chars = [c["chars"] for c in consult]
        print(f"  응답 길이        p50 {pct(chars,50):>4.0f}자 · max {max(chars)}자")

    # ── 비용 ──
    if usage:
        line("LLM 토큰·비용")
        tin = sum(u["in"] for u in usage)
        tout = sum(u["out"] for u in usage)
        tthink = sum(u["think"] for u in usage)
        tusd = sum(u["usd"] for u in usage)
        by_api = defaultdict(lambda: [0, 0.0])
        for u in usage:
            by_api[u["api"]][0] += 1
            by_api[u["api"]][1] += u["usd"]
        print(f"  집계된 콜        {len(usage)}건" + (f" (조기종료 {trunc}건은 토큰 미집계)" if trunc else ""))
        print(f"  입력 토큰        {tin:,}")
        print(f"  출력 토큰        {tout:,}  (사고 {tthink:,} 포함 시 {tout+tthink:,})")
        print(f"  비용             ${tusd:.4f}  (약 {tusd*KRW:,.0f}원)")
        if len(usage):
            print(f"  콜당 평균        ${tusd/len(usage):.5f}  (약 {tusd/len(usage)*KRW:.1f}원)")
        for api, (n, usd) in sorted(by_api.items(), key=lambda x: -x[1][1]):
            print(f"    └ {api:<8} {n:>3}콜  ${usd:.4f}")

    # ── 아바타 ──
    if relay:
        line("아바타(MuseTalk)")
        print(f"  발화 수          {len(relay)}")
        print(f"  첫 프레임        p50 {pct(relay,50):>6.0f}ms · p95 {pct(relay,95):>6.0f}ms · max {max(relay):.0f}ms")

    # ── TTS ──
    if tts:
        line("TTS")
        prov = Counter(t["provider"] for t in tts)
        ch = sum(t["chars"] for t in tts)
        print(f"  합성 수          {len(tts)}  ·  총 {ch:,}자")
        print(f"  제공자           " + " · ".join(f"{k} {v}" for k, v in prov.most_common()))
        if set(prov) - {"elevenlabs"}:
            print("  ⚠️ 폴백 발생 — 품질 지표(WER·MCD) 집계 시 해당 샘플 제외 필요")

    # ── HTTP ──
    if http:
        line("엔드포인트")
        ok = sum(1 for h in http if h["status"] < 400)
        err4 = sum(1 for h in http if 400 <= h["status"] < 500)
        err5 = sum(1 for h in http if h["status"] >= 500)
        print(f"  요청 수          {len(http)}  ·  2xx/3xx {ok} · 4xx {err4} · 5xx {err5}")
        slow = defaultdict(list)
        for h in http:
            slow[h["path"]].append(h["ms"])
        top = sorted(slow.items(), key=lambda kv: -pct(kv[1], 95))[:5]
        print("  느린 경로 (p95)")
        for path, ms in top:
            print(f"    {pct(ms,95):>7.0f}ms  {path}  ({len(ms)}회)")
        if err5:
            print("  ⚠️ 5xx 발생 경로: " + ", ".join(
                sorted({h["path"] for h in http if h["status"] >= 500})))

    if errors:
        line()
        print(f"  ⚠️ 에러/트레이스백 라인 {errors}건 — 원문 확인 권장")

    if not any([consult, usage, http, relay, tts]):
        print("\n  파싱된 로그가 없습니다.")
        print("  · 계측 로그는 배포 이후 기동분부터 남습니다(LLM-USAGE·HTTP-LATENCY).")
        print("  · docker compose logs 에 --since 를 너무 짧게 준 건 아닌지 확인하세요.")

    print()


if __name__ == "__main__":
    main()
