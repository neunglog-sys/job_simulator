"""Tiled(.tmx/.tmj) → geometry.json + review.csv + debug-overlay.html 변환기.

팀 맵 규격 (게임맵 좌표 설계):
  맵 1920×1080 / Orthogonal / 그리드 24×24 (80열×45행)
  레이어: background(이미지) · play_bounds(공통 가동범위 사각형 main_play_area)
        · walkable(걷는 바닥) · collision(책상·벽 등 통과 불가)
        · npc_paths(NPC 이동 경로 폴리라인) · interaction(상호작용 지점)
        · spawn(플레이어·NPC 자리 점 — name에 자리 ID: player, mentor_desk …)

사용법 (Tiled 원본 .tmx를 그대로 읽음 — JSON 내보내기 불필요):
  python scripts/tiled-to-geometry.py jobverse-maps/map_22_farm/map_22_farm.tmx
→ 같은 폴더에 geometry.json(좌표 원본), review.csv(엑셀 검수), debug-overlay.html(시각 검수) 생성.
  debug-overlay.html은 브라우저로 열면 배경 위에 레이어별 색으로 표시됨.

Tiled 팁: 사각형 R · 다각형/폴리라인 P (경로는 점 찍다 Enter). 폴리곤으로 그려도 점 목록만 쓰므로 무방.
"""

import argparse
import csv
import html
import json
import xml.etree.ElementTree as ET
from pathlib import Path

# 공통 플레이 영역 프리셋 — play_bounds 레이어가 비어 있으면 자동 적용 (팀 확정값)
DEFAULT_PLAYABLE = {"x": 70, "y": 80, "w": 1780, "h": 656, "id": "main_play_area"}

LAYER_ALIASES = {
    "play_bounds": "playable",
    "playable": "playable",
    "walkable": "walkable",
    "collision": "collision",
    "collisions": "collision",
    "npc_paths": "npc_paths",
    "npc_path": "npc_paths",
    "paths": "npc_paths",
    "interaction": "interactions",
    "interactions": "interactions",
    "spawn": "spawns",
    "spawns": "spawns",
}

OVERLAY_COLORS = {
    "playable": "rgba(241, 196, 15, 0.18)",
    "walkable": "rgba(46, 204, 113, 0.35)",
    "collision": "rgba(231, 76, 60, 0.40)",
    "interactions": "rgba(52, 152, 219, 0.50)",
    "spawns": "rgba(230, 126, 34, 0.95)",
    "npc_paths": "rgba(155, 89, 182, 0.9)",
}


def _round(value: float) -> int:
    return int(round(float(value)))


# ── Tiled 파일 로딩: .tmx(XML)와 .tmj(JSON)를 같은 dict 구조로 정규화 ──

def _load_tmj(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_tmx(path: Path) -> dict:
    root = ET.parse(path).getroot()
    doc = {
        "width": int(root.get("width", 0)),
        "height": int(root.get("height", 0)),
        "tilewidth": int(root.get("tilewidth", 0)),
        "tileheight": int(root.get("tileheight", 0)),
        "layers": [],
    }
    for el in root:
        if el.tag == "imagelayer":
            image = el.find("image")
            doc["layers"].append({
                "type": "imagelayer",
                "image": image.get("source") if image is not None else None,
            })
        elif el.tag == "objectgroup":
            objects = []
            for o in el.findall("object"):
                obj: dict = {
                    "id": o.get("id"),
                    "name": o.get("name", ""),
                    "x": float(o.get("x", 0)),
                    "y": float(o.get("y", 0)),
                    "width": float(o.get("width", 0)),
                    "height": float(o.get("height", 0)),
                }
                if o.find("point") is not None:
                    obj["point"] = True
                poly = o.find("polyline")
                if poly is None:
                    poly = o.find("polygon")
                if poly is not None:
                    obj["polyline"] = [
                        {"x": float(pair.split(",")[0]), "y": float(pair.split(",")[1])}
                        for pair in poly.get("points", "").split()
                    ]
                objects.append(obj)
            doc["layers"].append({
                "type": "objectgroup", "name": el.get("name", ""), "objects": objects,
            })
    return doc


def _rect(obj: dict) -> dict:
    out = {
        "x": _round(obj["x"]), "y": _round(obj["y"]),
        "w": _round(obj.get("width", 0)), "h": _round(obj.get("height", 0)),
    }
    if obj.get("name"):
        out["id"] = obj["name"]
    return out


def _point(obj: dict) -> dict:
    out = {"x": _round(obj["x"]), "y": _round(obj["y"])}
    if obj.get("name"):
        out["id"] = obj["name"]
    return out


def _path(obj: dict) -> dict:
    pts = obj.get("polyline") or []
    base_x, base_y = obj["x"], obj["y"]
    return {
        "id": obj.get("name") or f"path_{obj.get('id', '?')}",
        "points": [[_round(base_x + p["x"]), _round(base_y + p["y"])] for p in pts],
    }


def convert(tiled_path: Path) -> dict:
    doc = _load_tmx(tiled_path) if tiled_path.suffix.lower() == ".tmx" else _load_tmj(tiled_path)
    geometry: dict = {
        "map_id": tiled_path.stem,
        "size": {
            "width": doc.get("width", 0) * doc.get("tilewidth", 0),
            "height": doc.get("height", 0) * doc.get("tileheight", 0),
        },
        "playable": [],
        "walkable": [],
        "collision": [],
        "npc_paths": [],
        "interactions": [],
        "spawns": [],
        "background": None,
    }

    for layer in doc.get("layers", []):
        if layer.get("type") == "imagelayer" and layer.get("image"):
            geometry["background"] = Path(layer["image"]).name
            continue
        if layer.get("type") != "objectgroup":
            continue
        key = LAYER_ALIASES.get(layer.get("name", "").strip().lower())
        if key is None:
            continue
        for obj in layer.get("objects", []):
            if key == "npc_paths":
                geometry["npc_paths"].append(_path(obj))
            elif obj.get("point"):
                geometry[key].append(_point(obj))
            else:
                geometry[key].append(_rect(obj))

    if not geometry["playable"]:
        geometry["playable"] = [dict(DEFAULT_PLAYABLE)]
        geometry["playable_default"] = True  # 공통 프리셋 자동 적용됨 표시
    if not geometry["walkable"]:
        # "전체 개방 + collision으로 빼기" 방식 지원 — walkable을 안 그리면 play 영역 전체가 걷는 곳
        geometry["walkable"] = [dict(r) for r in geometry["playable"]]
        geometry["walkable_from_playable"] = True
    return geometry


def write_csv(geometry: dict, path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as f:  # 엑셀 한글 호환 BOM
        writer = csv.writer(f)
        writer.writerow(["layer", "id", "x", "y", "w", "h", "points"])
        for kind in ("playable", "walkable", "collision", "interactions", "spawns"):
            for item in geometry[kind]:
                writer.writerow([
                    kind, item.get("id", ""), item.get("x", ""), item.get("y", ""),
                    item.get("w", ""), item.get("h", ""), "",
                ])
        for p in geometry["npc_paths"]:
            writer.writerow([
                "npc_paths", p["id"], "", "", "", "",
                " → ".join(f"({x},{y})" for x, y in p["points"]),
            ])


def write_overlay(geometry: dict, path: Path) -> None:
    w = geometry["size"]["width"] or 1920
    h = geometry["size"]["height"] or 1080
    bg = geometry.get("background") or "background.png"
    parts: list[str] = []

    def box(rect: dict, kind: str, outline_only: bool = False) -> str:
        fill = "transparent" if outline_only else OVERLAY_COLORS[kind]
        border = OVERLAY_COLORS[kind].replace("0.18", "0.9") if outline_only else "rgba(0,0,0,.45)"
        return (
            f'<div class="box" style="left:{rect["x"]}px;top:{rect["y"]}px;width:{rect["w"]}px;'
            f'height:{rect["h"]}px;background:{fill};border-color:{border}">'
            f'<i>{html.escape(str(rect.get("id", kind)))}</i></div>'
        )

    def dot(pt: dict, kind: str) -> str:
        return (
            f'<div class="dot" style="left:{pt["x"]}px;top:{pt["y"]}px;'
            f'background:{OVERLAY_COLORS[kind]}"><i>{html.escape(str(pt.get("id", kind)))}</i></div>'
        )

    for r in geometry["playable"]:
        parts.append(box(r, "playable", outline_only=True))
    for r in geometry["walkable"]:
        parts.append(box(r, "walkable"))
    for r in geometry["collision"]:
        parts.append(box(r, "collision"))
    for r in geometry["interactions"]:
        parts.append(box(r, "interactions") if "w" in r and r.get("w") else dot(r, "interactions"))
    for s in geometry["spawns"]:
        parts.append(dot(s, "spawns"))
    for p in geometry["npc_paths"]:
        pts = " ".join(f"{x},{y}" for x, y in p["points"])
        parts.append(
            f'<svg class="path"><polyline points="{pts}" fill="none" '
            f'stroke="{OVERLAY_COLORS["npc_paths"]}" stroke-width="4" stroke-dasharray="10 6"/></svg>'
        )
        if p["points"]:
            x, y = p["points"][0]
            parts.append(dot({"x": x, "y": y, "id": p["id"]}, "npc_paths"))

    path.write_text(
        f"""<!doctype html><meta charset="utf-8"><title>{geometry["map_id"]} 좌표 검수</title>
<style>
body{{margin:0;background:#222;font-family:sans-serif}}
.stage{{position:relative;width:{w}px;height:{h}px;background:url("{bg}") 0 0/{w}px {h}px no-repeat;
  transform-origin:0 0;transform:scale(min(1, calc(100vw / {w})))}}
.box{{position:absolute;border:2px solid rgba(0,0,0,.45)}}
.dot{{position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid #fff;
  transform:translate(-50%,-50%)}}
.path{{position:absolute;inset:0;width:{w}px;height:{h}px;pointer-events:none}}
i{{position:absolute;top:-20px;left:0;color:#fff;font-size:12px;font-style:normal;
  text-shadow:0 1px 3px #000;white-space:nowrap}}
</style>
<div class="stage">{"".join(parts)}</div>""",
        encoding="utf-8",
    )


def write_playtest(geometry: dict, path: Path) -> None:
    """geometry가 실제로 '돌아가는지' 확인하는 미니 플레이 테스트 페이지.

    WASD/방향키로 플레이어를 움직여 walkable 안·collision 밖 판정(축분리 슬라이딩)을
    직접 체험. NPC 자리 근접 시 대화 힌트 표시. G 키로 좌표 오버레이 토글.
    게임 본편 코드와 무관한 검증용 — 판정 규칙(발 기준점 walkable ∧ 발박스 collision 비교차)은
    프론트 구현 시 그대로 참고 가능.
    """
    w = geometry["size"]["width"] or 1920
    h = geometry["size"]["height"] or 1080
    bg = geometry.get("background") or "background.png"
    data = json.dumps(
        {k: geometry[k] for k in ("playable", "walkable", "collision", "spawns", "npc_paths")},
        ensure_ascii=False,
    )
    path.write_text(
        f"""<!doctype html><meta charset="utf-8"><title>{geometry["map_id"]} 플레이 테스트</title>
<style>
body{{margin:0;background:#1a1a1a;font-family:sans-serif;overflow:hidden}}
#stage{{position:relative;width:{w}px;height:{h}px;background:url("{bg}") 0 0/{w}px {h}px no-repeat;
  transform-origin:0 0}}
.ov{{position:absolute;border:1px solid rgba(0,0,0,.4);display:none}}
.show .ov{{display:block}}
#player{{position:absolute;width:34px;height:44px;margin:-40px 0 0 -17px;z-index:10;
  transition:left 70ms linear,top 70ms linear}}
#player .body{{width:34px;height:34px;border-radius:50% 50% 42% 42%;
  background:linear-gradient(160deg,#6143ca,#d963aa);border:3px solid #fff;
  box-shadow:0 6px 14px rgba(0,0,0,.45)}}
#player .shadow{{width:26px;height:8px;margin:2px auto 0;border-radius:50%;background:rgba(0,0,0,.4)}}
.npc{{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
  background:#3498db;border:2px solid #fff;z-index:5}}
.npc b{{position:absolute;top:-22px;left:50%;transform:translateX(-50%);color:#fff;
  font-size:12px;font-weight:600;text-shadow:0 1px 3px #000;white-space:nowrap}}
#hint{{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:20;
  padding:10px 16px;border-radius:12px;background:rgba(20,12,50,.88);color:#fff;
  font-size:14px;display:none}}
#help{{position:fixed;top:10px;left:10px;z-index:20;color:#bbb;font-size:12px;
  background:rgba(0,0,0,.55);padding:6px 10px;border-radius:8px}}
</style>
<div id="stage"></div>
<div id="hint"></div>
<div id="help">이동: WASD/방향키 · 오버레이: G</div>
<script>
const G = {data};
const STEP = 18, FOOT_W = 28, FOOT_H = 16, TALK_DIST = 130;  // NPC가 책상 뒤라 책상 너머 대화 가능한 반경
const stage = document.getElementById("stage");

for (const [kind, color] of [["walkable","rgba(46,204,113,.30)"],["collision","rgba(231,76,60,.35)"]])
  for (const r of G[kind]) {{
    const d = document.createElement("div");
    d.className = "ov";
    d.style.cssText = `left:${{r.x}}px;top:${{r.y}}px;width:${{r.w}}px;height:${{r.h}}px;background:${{color}}`;
    stage.appendChild(d);
  }}

const npcs = G.spawns.filter(s => s.id !== "player");
for (const n of npcs) {{
  const d = document.createElement("div");
  d.className = "npc";
  d.style.cssText = `left:${{n.x}}px;top:${{n.y}}px`;
  d.innerHTML = `<b>${{n.id}}</b>`;
  stage.appendChild(d);
}}

const spawn = G.spawns.find(s => s.id === "player") || {{x: 200, y: 400}};
let px = spawn.x, py = spawn.y;
const player = document.createElement("div");
player.id = "player";
player.innerHTML = '<div class="body"></div><div class="shadow"></div>';
stage.appendChild(player);

const inWalkable = (x, y) => G.walkable.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
const hitsCollision = (x, y) => G.collision.some(r =>
  x - FOOT_W / 2 < r.x + r.w && x + FOOT_W / 2 > r.x && y - FOOT_H < r.y + r.h && y > r.y);
const canStand = (x, y) => inWalkable(x, y) && !hitsCollision(x, y);

function render() {{
  player.style.left = px + "px";
  player.style.top = py + "px";
  const near = npcs.map(n => ({{n, d: Math.hypot(n.x - px, n.y - py)}}))
    .filter(o => o.d < TALK_DIST).sort((a, b) => a.d - b.d)[0];
  const hint = document.getElementById("hint");
  hint.style.display = near ? "block" : "none";
  if (near) hint.textContent = `💬 ${{near.n.id}} 자리 — 여기서 '대화하기' 버튼이 뜹니다`;
}}

document.addEventListener("keydown", (e) => {{
  const k = e.key.toLowerCase();
  if (k === "g") {{ stage.classList.toggle("show"); return; }}
  const d = {{arrowup:[0,-STEP], w:[0,-STEP], arrowdown:[0,STEP], s:[0,STEP],
             arrowleft:[-STEP,0], a:[-STEP,0], arrowright:[STEP,0], d:[STEP,0]}}[k];
  if (!d) return;
  e.preventDefault();
  if (canStand(px + d[0], py)) px += d[0];   // 축 분리 → 벽에 스치며 슬라이딩
  if (canStand(px, py + d[1])) py += d[1];
  render();
}});

const fit = () => stage.style.transform = `scale(${{Math.min(1, innerWidth / {w}, innerHeight / {h})}})`;
addEventListener("resize", fit); fit(); render();
// 자동 검증용 훅 (게임과 무관)
window.__pt = {{ get pos() {{ return [px, py]; }}, set(x, y) {{ px = x; py = y; render(); }},
  canStand, players: document.querySelectorAll("#player").length }};
</script>""",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Tiled .tmx/.tmj → geometry.json 변환")
    parser.add_argument("tiled_file", type=Path, help="Tiled 파일 (.tmx 또는 .tmj)")
    args = parser.parse_args()

    geometry = convert(args.tiled_file)
    out_dir = args.tiled_file.parent
    (out_dir / "geometry.json").write_text(
        json.dumps(geometry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_csv(geometry, out_dir / "review.csv")
    write_overlay(geometry, out_dir / "debug-overlay.html")
    write_playtest(geometry, out_dir / "playtest.html")

    counts = {
        k: len(geometry[k])
        for k in ("playable", "walkable", "collision", "npc_paths", "interactions", "spawns")
    }
    print(f"[{geometry['map_id']}] geometry.json / review.csv / debug-overlay.html 생성")
    print("  " + " · ".join(f"{k} {v}" for k, v in counts.items())
          + ("  (playable은 공통 프리셋 자동 적용)" if geometry.get("playable_default") else ""))


if __name__ == "__main__":
    main()
