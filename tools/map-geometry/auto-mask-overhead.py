"""overhead(가림) 사각형 → 가구 픽셀 마스크 자동 생성 + TMX에 mask 속성 주입.

문제: paint.html에서 overhead를 24px 격자 사각형으로 칠하면, 오클루더 밑변이
가구 실제 윤곽이 아니라 네모난 격자선이 된다. 그 네모 안의 '바닥' 픽셀이
캐릭터 위에 다시 그려지면서 캐릭터가 블록처럼 잘려 보인다 (가이드 §3).

이 스크립트: TMX의 overhead 오브젝트마다 make-occluder-mask.py 로직으로
가구 픽셀만 남긴 마스크 PNG(mask_<i>.png)를 만들고, 그 오브젝트에
<property name="mask" value="mask_<i>.png"/> 를 달아준다. 이후 tiled-to-geometry.py가
geometry에 싣고 playtest/게임이 CSS mask로 가구 윤곽대로만 그려 → 잘림이 사라진다.

오차는 후처리(닫힘+침식)로 항상 '가구 안쪽'으로 나므로, 바닥이 캐릭터를 자르는
오탐은 나지 않는다. 색이 바닥과 비슷해 덜 잡힌 가구는 살짝 덜 가릴 뿐(안전한 실패).

사용법:
  python tools/map-geometry/auto-mask-overhead.py maps/<slug>/<slug>.tmx
  옵션: --min-floor 0.06  (가구가 이 비율 미만이면 '전부 가구'로 보고 마스크 생략 = 사각형 유지)
  이미 mask 속성이 있는 오브젝트는 건드리지 않는다 (수동 지정 존중).
"""

import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageFilter


def build_mask(px, W, H, x, y, w, h, thresh=None):
    """bbox 안에서 '따뜻한 회색 바닥'이 아닌 픽셀 = 가구. L 마스크 + 가구 비율.

    타일/콘크리트(따뜻한 회색) 바닥에는 잘 먹는다. 파란 카펫 등 다른 바닥은 이 규칙으로
    분리가 안 되므로(가구로 오판), 그런 구역은 마스크 대신 사각형을 유지하거나 손보정한다.
    thresh 인자는 하위호환용 placeholder (warm-grey 방식은 안 씀).
    """
    m = 6
    samples = [(x - m, y - m), (x + w + m, y - m), (x - m, y + h + m), (x + w + m, y + h + m)]
    cols = []
    for sx, sy in samples:
        sx = max(0, min(W - 1, sx)); sy = max(0, min(H - 1, sy))
        cols.append(px[sx, sy])
    lo = min(c[0] for c in cols) - 20
    hi = max(c[0] for c in cols) + 13

    def is_floor(r, g, b):
        return lo < r < hi and r > g > b and (r - b) < 28  # 따뜻한 회색 타일

    mk = Image.new("L", (w, h), 0)
    mp = mk.load()
    for dx in range(w):
        xx = x + dx
        if xx < 0 or xx >= W:
            continue
        for dy in range(h):
            yy = y + dy
            if yy < 0 or yy >= H:
                continue
            if not is_floor(*px[xx, yy]):
                mp[dx, dy] = 255
    mk = (mk.filter(ImageFilter.MaxFilter(3))   # 닫힘: 작은 구멍 메움
            .filter(ImageFilter.MinFilter(3))
            .filter(ImageFilter.MinFilter(3)))  # 1px 침식: 가구 안쪽 바이어스
    furn = sum(1 for v in mk.get_flattened_data() if v) / (w * h)
    return mk, furn


def main() -> None:
    ap = argparse.ArgumentParser(description="overhead 사각형 → 가구 픽셀 마스크 자동화")
    ap.add_argument("tmx", type=Path)
    ap.add_argument("--min-floor", type=float, default=0.06,
                    help="가구 비율이 (1-이값) 이상이면 바닥이 거의 없음 → 마스크 생략(사각형 유지)")
    ap.add_argument("--thresh", type=int, default=42, help="바닥으로 볼 색 거리(유클리드)")
    ap.add_argument("--force", action="store_true",
                    help="기존 mask 속성을 걷어내고 전부 재생성 (알고리즘 바뀌었을 때)")
    args = ap.parse_args()

    tmx = args.tmx
    map_dir = tmx.parent
    slug = tmx.stem
    png = map_dir / f"{slug}.png"
    if not png.exists():
        raise SystemExit(f"배경 PNG 없음: {png}")

    img = Image.open(png).convert("RGB")
    W, H = img.size
    px = img.load()

    tree = ET.parse(tmx)
    root = tree.getroot()
    over = None
    for og in root.findall("objectgroup"):
        if (og.get("name") or "").strip().lower() in ("overhead", "occluder", "occluders", "foreground"):
            over = og
            break
    if over is None:
        raise SystemExit("overhead 레이어가 없습니다.")

    made = skipped = kept = 0
    for i, obj in enumerate(over.findall("object")):
        w = int(round(float(obj.get("width", 0))))
        h = int(round(float(obj.get("height", 0))))
        if w <= 0 or h <= 0:
            continue
        props = obj.find("properties")
        if props is not None:
            masks = [p for p in props.findall("property") if p.get("name") == "mask"]
            if masks and args.force:
                for p in masks:     # 재생성: 기존 mask 속성 제거
                    props.remove(p)
            elif masks:
                kept += 1           # 존중: 이미 지정된 마스크
                continue
        x = int(round(float(obj.get("x", 0))))
        y = int(round(float(obj.get("y", 0))))
        mk, furn = build_mask(px, W, H, x, y, w, h, thresh=args.thresh)
        # 바닥이 거의 없으면(가구가 꽉 참) 사각형 그대로가 더 안전·정확 → 마스크 생략
        if furn >= 1 - args.min_floor:
            skipped += 1
            continue
        name = f"mask_{i:03d}.png"
        rgba = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        rgba.putalpha(mk)
        rgba.save(map_dir / name)
        if props is None:
            props = ET.SubElement(obj, "properties")
        ET.SubElement(props, "property", {"name": "mask", "value": name})
        made += 1

    tree.write(tmx, encoding="utf-8", xml_declaration=True)
    print(f"[{slug}] 마스크 {made}개 생성 · 사각형 유지(가구꽉참) {skipped} · 기존 mask 존중 {kept}")
    print("  → 이제 tiled-to-geometry.py 재실행하면 geometry에 반영됩니다.")


if __name__ == "__main__":
    main()
