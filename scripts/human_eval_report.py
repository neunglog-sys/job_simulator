#!/usr/bin/env python3
"""휴먼 평가 집계 — 점수보다 **그 점수를 믿어도 되는지**를 먼저 낸다.

설계는 docs/evaluation/휴먼평가_설계.md 참고. 표준 라이브러리만 쓴다.

내는 것:
    ① 차원별 평균·표준편차·최저값     보고용 수치
    ② 평가자 간 ±1점 일치율            ①을 보고해도 되는지 판정
    ③ 층별 비교(지식형 vs 비지식형)     RAG 경로가 실제로 나은지
    ④ 평가자가 갈린 항목 목록          앵커를 고칠 지점

②가 60% 미만이면 ①을 아예 출력하지 않는다. 앵커가 실패한 상태에서 평균을 내면
합의되지 않은 숫자가 보고서에 실려 혼자 걸어다닌다.

사용:
    python3 scripts/human_eval_report.py humaneval/
"""

import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

# 등급 표시에 이모지를 쓰므로 콘솔이 UTF-8이 아니면 죽는다(Windows cp949).
# VM은 UTF-8이지만 어디서 돌려도 결과가 나와야 한다.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DIMENSIONS = ("natural", "relevant", "helpful", "safe")
LABEL = {"natural": "자연스러움", "relevant": "적절성", "helpful": "도움됨", "safe": "안전성"}
AGREE_GREEN, AGREE_YELLOW = 80.0, 60.0


def load(folder: Path):
    """평가자별 시트 → {item_id: {rater: {dim: score}}}. 빈 칸은 조용히 건너뛴다."""
    scores: dict[str, dict[str, dict[str, int]]] = defaultdict(dict)
    texts: dict[str, tuple[str, str]] = {}
    memos: list[tuple[str, str, str]] = []
    sheets = sorted(folder.glob("sheet_*.csv"))
    if not sheets:
        sys.exit(f"시트가 없다: {folder}/sheet_*.csv")

    for sheet in sheets:
        rater = sheet.stem.replace("sheet_", "")
        with sheet.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                item = (row.get("item_id") or "").strip()
                if not item:
                    continue
                texts.setdefault(item, (row.get("사용자 발화", ""), row.get("상담사 응답", "")))
                got = {}
                for d in DIMENSIONS:
                    raw = (row.get(d) or "").strip()
                    if raw.isdigit() and 1 <= int(raw) <= 5:
                        got[d] = int(raw)
                if got:
                    scores[item][rater] = got
                memo = (row.get("메모") or "").strip()
                if memo:
                    memos.append((item, rater, memo))
    return scores, texts, memos, [s.stem.replace("sheet_", "") for s in sheets]


def agreement(scores, dim) -> tuple[float, int]:
    """±1점 이내 일치율 — 평가자 쌍 단위. 5점 척도에서 완전일치는 사람도 잘 못 맞춘다."""
    hit = total = 0
    for per_rater in scores.values():
        vals = [v[dim] for v in per_rater.values() if dim in v]
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                total += 1
                hit += abs(vals[i] - vals[j]) <= 1
    return (hit / total * 100 if total else 0.0), total


def main() -> int:
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "humaneval")
    scores, texts, memos, raters = load(folder)
    key_path = folder / "KEY_do_not_share.json"
    strata = {}
    seed = "-"
    if key_path.exists():
        key = json.loads(key_path.read_text(encoding="utf-8"))
        seed = key.get("seed", "-")
        strata = {i["item_id"]: i["stratum"] for i in key.get("items", [])}

    print("=" * 60)
    print(" 휴먼 평가 결과")
    print("=" * 60)
    print(f"  평가자 {len(raters)}인 ({', '.join(raters)}) · 항목 {len(scores)}건 · 시드 {seed}")

    filled = [i for i, v in scores.items() if len(v) == len(raters)]
    if len(filled) < len(scores):
        print(f"  ⚠️ 전원이 채운 항목은 {len(filled)}/{len(scores)}건 — 나머지는 일치도에서 빠진다")

    # ── ② 일치도 먼저 ──
    print("\n── 평가자 간 일치도 (±1점) " + "─" * 30)
    verdicts = {}
    for d in DIMENSIONS:
        rate, pairs = agreement(scores, d)
        mark = "🟢" if rate >= AGREE_GREEN else ("🟡" if rate >= AGREE_YELLOW else "🔴")
        verdicts[d] = rate
        print(f"  {LABEL[d]:<8} {rate:5.1f}%  {mark}   (비교쌍 {pairs})")

    blocked = [d for d, r in verdicts.items() if r < AGREE_YELLOW]
    if blocked:
        print("\n  🔴 일치율 60% 미만 차원: " + ", ".join(LABEL[d] for d in blocked))
        print("     이 차원은 **점수를 보고하지 않는다** — 앵커가 실패한 것이다.")
        print("     설계 문서의 1·3·5점 기술을 고쳐 다시 잰다.")

    # ── ① 점수 ──
    print("\n── 차원별 점수 " + "─" * 42)
    for d in DIMENSIONS:
        vals = [s[d] for per in scores.values() for s in per.values() if d in s]
        if not vals:
            continue
        if d in blocked:
            print(f"  {LABEL[d]:<8} (일치도 미달로 보고 보류)")
            continue
        sd = statistics.stdev(vals) if len(vals) > 1 else 0.0
        low = sum(1 for v in vals if v <= 2)
        print(f"  {LABEL[d]:<8} 평균 {statistics.mean(vals):.2f} · sd {sd:.2f} · "
              f"최저 {min(vals)} · 2점 이하 {low}건")

    # ── ③ 층별 ──
    if strata:
        print("\n── 층별 비교 (지식형 vs 비지식형) " + "─" * 24)
        for d in DIMENSIONS:
            if d in blocked:
                continue
            by = defaultdict(list)
            for item, per in scores.items():
                st = strata.get(item)
                if st:
                    by[st] += [s[d] for s in per.values() if d in s]
            if by.get("kb") and by.get("no_kb"):
                a, b = statistics.mean(by["kb"]), statistics.mean(by["no_kb"])
                print(f"  {LABEL[d]:<8} 지식형 {a:.2f} · 비지식형 {b:.2f} · 차이 {a-b:+.2f}")
        print("  ※ 평가자 3인·표본 소규모라 '유의미한 차이'로 읽지 말 것.")

    # ── ④ 갈린 항목 ──
    print("\n── 평가자가 갈린 항목 (2점 이상 차이) " + "─" * 20)
    split = []
    for item, per in scores.items():
        for d in DIMENSIONS:
            vals = [s[d] for s in per.values() if d in s]
            if len(vals) > 1 and max(vals) - min(vals) >= 2:
                split.append((item, d, vals))
    if not split:
        print("  없음")
    for item, d, vals in split[:15]:
        user, reply = texts.get(item, ("", ""))
        print(f"  {item} {LABEL[d]} {vals}")
        print(f"     Q: {user[:50]}")
        print(f"     A: {reply[:70]}")
    if len(split) > 15:
        print(f"  … 외 {len(split)-15}건")
    if split:
        print("  → 여기가 앵커를 고칠 지점이다. 점수보다 이 목록을 먼저 본다.")

    # ── ③' LLM 심판 대조 ──
    geval_path = folder / "geval.json"
    if geval_path.exists():
        gv = {i["item_id"]: i for i in json.loads(geval_path.read_text(encoding="utf-8"))["items"]}
        print("\n── LLM 심판(G-Eval) 대조 " + "─" * 32)
        print("  이 평가의 본론이다 — 심판이 사람과 같은 방향을 보는지 확인한다.")
        gaps = []
        for d in DIMENSIONS:
            if d in blocked:
                continue
            pairs = []
            for item, per in scores.items():
                hv = [s_[d] for s_ in per.values() if d in s_]
                if hv and item in gv:
                    pairs.append((item, statistics.mean(hv), gv[item][d]))
            if not pairs:
                continue
            hm = statistics.mean(p[1] for p in pairs)
            gm = statistics.mean(p[2] for p in pairs)
            diff = gm - hm
            tone = "심판이 후하다" if diff > 0.3 else ("심판이 박하다" if diff < -0.3 else "대체로 일치")
            print(f"  {LABEL[d]:<8} 사람 {hm:.2f} · 심판 {gm:.2f} · 차이 {diff:+.2f}  → {tone}")
            gaps += [(item, d, h, g) for item, h, g in pairs if abs(g - h) >= 1.5]
        if gaps:
            print(f"\n  1.5점 이상 어긋난 항목 {len(gaps)}건 — **여기가 심판을 고칠 지점이다**")
            for item, d, h, g in sorted(gaps, key=lambda x: -abs(x[3] - x[2]))[:10]:
                user, reply = texts.get(item, ("", ""))
                print(f"    {item} {LABEL[d]} 사람 {h:.1f} vs 심판 {g:.1f}")
                print(f"       Q: {user[:50]}")
                print(f"       A: {reply[:70]}")
        else:
            print("\n  1.5점 이상 어긋난 항목 없음 — 심판을 자동 회귀 지표로 계속 써도 된다.")
    else:
        print("\n  (geval.json 없음 — eval_geval.py --out 로 만들면 심판 대조까지 나온다)")

    if memos:
        print("\n── 메모 " + "─" * 49)
        for item, rater, memo in memos[:20]:
            print(f"  {item} [{rater}] {memo}")

    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
