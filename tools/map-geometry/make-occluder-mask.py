"""배경 PNG에서 가구 픽셀 알파 마스크(누끼) 생성 — overhead 오클루더용.

폴리곤은 열마다 경계가 한 줄이라 케이블·기둥 틈새로 보이는 바닥까지 물게 된다.
픽셀 단위로 확실히 따야 하는 가구는 이 스크립트로 마스크 PNG를 만들고,
Tiled 오브젝트(사각형 = bbox)에 커스텀 속성 mask=<파일명>을 달면
컨버터(tiled-to-geometry.py)가 geometry에 싣고 playtest가 CSS mask로 그린다.

사용법:
  python tools/map-geometry/make-occluder-mask.py <배경.png> <x> <y> <w> <h> <출력.png> [바닥표본x,y ...]

바닥 표본을 안 주면 bbox 네 모서리 바깥쪽 픽셀을 표본으로 쓴다.
판정: 표본들과 색이 비슷한 "따뜻한 회색"이면 바닥, 아니면 가구.
후처리: 닫힘(구멍 메움) + 1px 침식 — 오차가 나도 바닥이 아니라 가구 안쪽으로.
"""

import sys
from PIL import Image, ImageFilter


def main() -> None:
    src, x, y, w, h, out_path = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
    img = Image.open(src).convert("RGB")
    px = img.load()

    if len(sys.argv) > 7:
        samples = [tuple(map(int, a.split(","))) for a in sys.argv[7:]]
    else:
        m = 6  # bbox 바로 바깥 네 모서리
        samples = [(x - m, y - m), (x + w + m, y - m), (x - m, y + h + m), (x + w + m, y + h + m)]
    cols = [px[sx, sy] for sx, sy in samples]
    # 밝기 대역은 표본에서 유도 — 흰 가구 상판(표본보다 밝음)이 바닥으로 새지 않게 상한이 중요
    lo = min(c[0] for c in cols) - 20
    hi = max(c[0] for c in cols) + 13

    def is_floor(r: int, g: int, b: int) -> bool:
        return lo < r < hi and r > g > b and (r - b) < 28  # 따뜻한 회색 타일 패턴

    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for dx in range(w):
        for dy in range(h):
            if not is_floor(*px[x + dx, y + dy]):
                mp[dx, dy] = 255
    mask = (mask.filter(ImageFilter.MaxFilter(3))   # 닫힘: 작은 구멍 메움
                .filter(ImageFilter.MinFilter(3))
                .filter(ImageFilter.MinFilter(3)))  # 1px 침식: 가구 안쪽 바이어스

    rgba = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    rgba.putalpha(mask)
    rgba.save(out_path)
    cover = sum(1 for v in mask.get_flattened_data() if v) / (w * h)
    print(f"{out_path}: {w}x{h}, 가구 픽셀 {cover:.0%} (Tiled 오브젝트에 mask 속성으로 연결)")


if __name__ == "__main__":
    main()
