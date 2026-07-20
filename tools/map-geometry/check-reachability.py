"""맵 검수 — 게임과 같은 판정으로 '실제로 걸어서 어디까지 가지는지' 확인.

playtest.html을 손으로 걸어보는 것을 자동화한 것. 플레이어 spawn에서 시작해 발판
판정(walkable 안 ∧ collision 밖)으로 격자 탐색하고, NPC 자리와 지정 구역의 도달
여부를 보고한다. 도달 영역을 배경 위에 초록으로 칠한 이미지도 남겨 눈으로 확인한다.

사용법:
  python tools/map-geometry/check-reachability.py <slug> [x,y:이름 ...]
예:
  python tools/map-geometry/check-reachability.py cln-01 480,700:청소실 760,700:사무실
"""

import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

# 프론트(MovementArea)와 같은 값 — 여기가 어긋나면 검수 의미가 없다
FOOT_W, FOOT_H = 46, 26
STEP = 6  # 탐색 격자 (실제 이동단위 18px보다 촘촘하게 — 좁은 문도 놓치지 않게)


def main() -> None:
    slug = sys.argv[1]
    probes = []
    for arg in sys.argv[2:]:
        pos, _, name = arg.partition(":")
        x, y = pos.split(",")
        probes.append((name or pos, int(x), int(y)))

    map_dir = Path("maps") / slug
    geo = json.loads((map_dir / "geometry.json").read_text(encoding="utf-8"))
    walk = geo["walkable"][0]
    coll = geo["collision"]
    polys = geo.get("collision_polys") or []

    def in_poly(x: float, y: float, pts: list) -> bool:
        inside = False
        for i in range(len(pts)):
            xi, yi = pts[i]
            xj, yj = pts[i - 1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        return inside

    def can_stand(x: float, y: float) -> bool:
        if not (walk["x"] <= x <= walk["x"] + walk["w"] and walk["y"] <= y <= walk["y"] + walk["h"]):
            return False
        fx, fy = x - FOOT_W / 2, y - FOOT_H
        if any(fx < r["x"] + r["w"] and fx + FOOT_W > r["x"]
               and fy < r["y"] + r["h"] and fy + FOOT_H > r["y"] for r in coll):
            return False
        corners = [(fx, fy), (fx + FOOT_W, fy), (fx, fy + FOOT_H), (fx + FOOT_W, fy + FOOT_H)]
        return not any(in_poly(cx, cy, p["points"]) for p in polys for cx, cy in corners)

    spawn = next((s for s in geo["spawns"] if s["id"] == "player"), None)
    if spawn is None:
        sys.exit("❌ player spawn 없음")
    start = (spawn["x"] // STEP * STEP, spawn["y"] // STEP * STEP)
    if not can_stand(*start):
        print("❌ player spawn이 collision 안 — 시작하자마자 갇힘")

    seen = {start}
    queue = deque([start])
    while queue:
        x, y = queue.popleft()
        for nxt in ((x - STEP, y), (x + STEP, y), (x, y - STEP), (x, y + STEP)):
            if nxt not in seen and can_stand(*nxt):
                seen.add(nxt)
                queue.append(nxt)

    print(f"[{slug}] 도달 가능 지점 {len(seen)}개")
    ok = True
    for s in geo["spawns"]:
        if s["id"] == "player":
            continue
        near = min((abs(a - s["x"]) + abs(b - s["y"]) for a, b in seen), default=10**9)
        # 근접 대화 반경 130px 안에 플레이어가 설 수 있어야 대화가 가능하다
        verdict = "OK" if near <= 130 else "❌ 접근 불가"
        ok &= near <= 130
        print(f"  NPC {s['id']:<10} 도달권까지 {near}px  {verdict}")
    for name, x, y in probes:
        reach = any(abs(a - x) < STEP * 3 and abs(b - y) < STEP * 3 for a, b in seen)
        ok &= reach
        print(f"  구역 {name:<12} {'OK' if reach else '❌ 도달 불가'}")

    out = map_dir / "reachability.png"
    img = Image.open(map_dir / f"{slug}.png").convert("RGB")
    draw = ImageDraw.Draw(img, "RGBA")
    for x, y in seen:
        draw.rectangle([x - 2, y - 2, x + 2, y + 2], fill=(0, 255, 120, 110))
    for s in geo["spawns"]:
        color = (0, 255, 0) if s["id"] == "player" else (255, 210, 0)
        draw.ellipse([s["x"] - 9, s["y"] - 9, s["x"] + 9, s["y"] + 9], fill=color, outline=(0, 0, 0))
        draw.text((s["x"] + 12, s["y"] - 8), s["id"], fill=color)
    img.save(out)
    print(f"  → 도달 영역 이미지: {out}")
    print("결과:", "통과" if ok else "미달 — 위 ❌ 항목 수정 필요")


if __name__ == "__main__":
    main()
