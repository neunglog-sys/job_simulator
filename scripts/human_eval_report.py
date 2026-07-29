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

import contextlib
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl

# 등급 표시에 이모지를 쓰므로 콘솔이 UTF-8이 아니면 죽는다(Windows cp949).
# VM은 UTF-8이지만 어디서 돌려도 결과가 나와야 한다.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DIMENSIONS = ("natural", "relevant", "helpful", "safe")
LABEL = {"natural": "자연스러움", "relevant": "적절성", "helpful": "도움됨", "safe": "안전성"}
AGREE_GREEN, AGREE_YELLOW = 80.0, 60.0


@contextlib.contextmanager
def _open_rows(path: Path):
    """csv·xlsx를 같은 모양(dict 이터레이터)으로 읽는다."""
    if path.suffix.lower() == ".xlsx":
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            rows = wb[wb.sheetnames[0]].iter_rows(values_only=True)
            header = [str(c).strip() if c is not None else "" for c in next(rows)]
            yield (
                {h: ("" if v is None else str(v).strip()) for h, v in zip(header, r)}
                for r in rows
            )
        finally:
            wb.close()
    else:
        with path.open(encoding="utf-8-sig", newline="") as f:
            yield csv.DictReader(f)


def load(folder: Path):
    """평가자별 시트 → {item_id: {rater: {dim: score}}}. 빈 칸은 조용히 건너뛴다."""
    scores: dict[str, dict[str, dict[str, int]]] = defaultdict(dict)
    texts: dict[str, tuple[str, str]] = {}
    memos: list[tuple[str, str, str]] = []
    # 평가자는 스프레드시트로 채워 돌려주는 게 자연스럽다(구글 시트 → xlsx 내려받기).
    # xlsx가 있으면 그쪽을 쓰고, 없으면 csv를 읽는다 — 같은 평가자의 빈 csv가 남아 있어도
    # 채운 xlsx가 덮어쓰게 한다.
    by_rater: dict[str, Path] = {}
    for sheet in sorted(folder.glob("sheet_*.csv")) + sorted(folder.glob("sheet_*.xlsx")):
        by_rater[sheet.stem.replace("sheet_", "")] = sheet
    sheets = [by_rater[k] for k in sorted(by_rater)]
    if not sheets:
        sys.exit(f"시트가 없다: {folder}/sheet_*.csv|xlsx")

    for sheet in sheets:
        rater = sheet.stem.replace("sheet_", "")
        with _open_rows(sheet) as reader:
            for row in reader:
                item = (row.get("item_id") or "").strip()
                if not item:
                    continue
                texts.setdefault(item, (row.get("사용자 발화", ""), row.get("상담사 응답", "")))
                got = {}
                for d in DIMENSIONS:
                    # 스프레드시트는 숫자를 실수로 저장한다("5" -> "5.0"). 정수만 받으면
                    # xlsx로 채운 시트가 통째로 빈 칸으로 읽힌다(실측: 40행 전부 유실).
                    raw = (row.get(d) or "").strip()
                    try:
                        v = int(round(float(raw)))
                    except (TypeError, ValueError):
                        continue
                    if 1 <= v <= 5:
                        got[d] = v
                if got:
                    scores[item][rater] = got
                memo = (row.get("메모") or "").strip()
                if memo:
                    memos.append((item, rater, memo))
    return scores, texts, memos, [s.stem.replace("sheet_", "") for s in sheets]


def _pearson(x, y):
    """표준편차가 0이면 정의되지 않는다(전원 같은 점수) — None으로 돌려준다."""
    if len(x) < 2:
        return None
    mx, my = statistics.mean(x), statistics.mean(y)
    dx = math.sqrt(sum((a - mx) ** 2 for a in x))
    dy = math.sqrt(sum((b - my) ** 2 for b in y))
    if dx == 0 or dy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (dx * dy)


def _ranks(v):
    """동점은 평균 순위 — Spearman 계산용."""
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


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
    # 평가자가 1명이면 평가자 간 일치도가 성립하지 않는다. 대신 몰래 두 번 물은 항목
    # (R### = H###의 사본)으로 **본인과의 일치도**를 낸다.
    retest_pairs = {}
    if key_path.exists():
        retest_pairs = json.loads(key_path.read_text(encoding="utf-8")).get("retest_pairs", {})

    solo = len(raters) == 1
    if solo and retest_pairs:
        print("\n── 재평가 일치도 (같은 항목 두 번, ±1점) " + "─" * 17)
        print("  평가자가 1명이라 평가자 간 일치도 대신 **본인과의 일치도**를 낸다.")
        verdicts = {}
        for d in DIMENSIONS:
            hit = total = 0
            for copy_id, orig_id in retest_pairs.items():
                a = scores.get(orig_id, {}).get(raters[0], {}).get(d)
                b = scores.get(copy_id, {}).get(raters[0], {}).get(d)
                if a is not None and b is not None:
                    total += 1
                    hit += abs(a - b) <= 1
            rate = hit / total * 100 if total else 0.0
            mark = "🟢" if rate >= AGREE_GREEN else ("🟡" if rate >= AGREE_YELLOW else "🔴")
            verdicts[d] = rate
            print(f"  {LABEL[d]:<8} {rate:5.1f}%  {mark}   (재평가쌍 {total})")
        print("\n  ⚠️ 이건 '앵커를 일관되게 적용했는가'만 말해준다.")
        print("     '다른 사람도 같게 볼까'는 1인 평가로는 원리적으로 알 수 없다 —")
        print("     보고서에 한계로 적을 것.")
    else:
        print("\n── 평가자 간 일치도 (±1점) " + "─" * 30)
        verdicts = {}
        for d in DIMENSIONS:
            rate, pairs = agreement(scores, d)
            mark = "🟢" if rate >= AGREE_GREEN else ("🟡" if rate >= AGREE_YELLOW else "🔴")
            verdicts[d] = rate
            print(f"  {LABEL[d]:<8} {rate:5.1f}%  {mark}   (비교쌍 {pairs})")
        if solo:
            print("\n  ⚠️ 평가자 1명인데 재평가 항목이 없어 일치도를 잴 수 없다.")
            print("     build_human_eval_sheet.py --raters 1 --retest 10 으로 다시 만들 것.")

    blocked = [d for d, r in verdicts.items() if r < AGREE_YELLOW]
    if blocked:
        print("\n  🔴 일치율 60% 미만 차원: " + ", ".join(LABEL[d] for d in blocked))
        print("     이 차원은 **점수를 보고하지 않는다** — 앵커가 실패한 것이다.")
        print("     설계 문서의 1·3·5점 기술을 고쳐 다시 잰다.")

    # ── ① 점수 ──
    # 재평가 사본(R###)은 같은 응답을 두 번 센 것이라 평균에 넣으면 그 항목만 가중된다.
    # 일치도 계산에서만 쓰고 여기서는 뺀다.
    scored_items = {k: v for k, v in scores.items() if k not in retest_pairs}
    if retest_pairs:
        print(f"\n  (재평가 사본 {len(retest_pairs)}건은 점수 집계에서 제외 — 중복 계상 방지)")

    print("\n── 차원별 점수 " + "─" * 42)
    for d in DIMENSIONS:
        vals = [s[d] for per in scored_items.values() for s in per.values() if d in s]
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
            for item, per in scored_items.items():
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
    for item, per in scored_items.items():
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
        corr_notes: list = []
        for d in DIMENSIONS:
            if d in blocked:
                continue
            pairs = []
            for item, per in scored_items.items():
                hv = [s_[d] for s_ in per.values() if d in s_]
                if hv and item in gv:
                    pairs.append((item, statistics.mean(hv), gv[item][d]))
            if not pairs:
                continue
            hm = statistics.mean(p[1] for p in pairs)
            gm = statistics.mean(p[2] for p in pairs)
            diff = gm - hm
            tone = "심판이 후하다" if diff > 0.3 else ("심판이 박하다" if diff < -0.3 else "대체로 일치")
            # 평균이 맞는 것과 항목별로 같은 순서를 매기는 것은 다르다. 가이드가 요구하는
            # "인간 평가와 상관관계 80%+"는 후자라, 상관계수를 따로 낸다.
            hv_all = [x[1] for x in pairs]
            gv_all = [x[2] for x in pairs]
            r = _pearson(hv_all, gv_all)
            rho = _pearson(_ranks(hv_all), _ranks(gv_all))
            spread = statistics.pstdev(hv_all) if len(hv_all) > 1 else 0.0
            corr_notes.append((d, r, spread))
            print(f"  {LABEL[d]:<8} 사람 {hm:.2f} · 심판 {gm:.2f} · 차이 {diff:+.2f}  → {tone}")
            print(f"  {'':8}   Pearson {'계산불가' if r is None else format(r, '.3f')} · "
                  f"Spearman {'계산불가' if rho is None else format(rho, '.3f')} · "
                  f"사람 점수 분산 {spread:.3f}")
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

        # 상관계수는 점수가 퍼져 있어야 뜻이 있다. 대부분이 4.7~5.0에 몰리면(천장 효과)
        # 남는 건 잡음뿐이라 계수가 낮게 나온다 — 심판이 틀려서가 아니다.
        flat = [d for d, _r, sp in corr_notes if sp < 0.5]
        if flat:
            print("\n  ⚠️ 상관계수 해석 주의 — " + ", ".join(LABEL[d] for d in flat) + "의")
            print("     사람 점수 분산이 0.5 미만이다(천장 효과). 이 구간에서는 상관계수가 낮게")
            print("     나오는 게 정상이며, '심판이 사람과 다르게 본다'로 읽으면 안 된다.")
            print("     상관을 제대로 재려면 점수가 퍼지는 표본(엣지·위험 위주)이 필요하다.")
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
