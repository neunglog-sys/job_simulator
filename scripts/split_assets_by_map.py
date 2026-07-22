"""Classify flattened cartoon sheets in assets_by_map into runtime WebP sprites.

The supplied PNGs contain a baked light checkerboard instead of an alpha
channel.  This script removes that checkerboard, applies an explicit semantic
mapping for every game, and writes the existing YAML asset ids as 512px
lossless WebP files.  Gameplay YAML is intentionally untouched.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets_by_map"
ASSET_DIR = ROOT / "apps" / "web" / "public" / "assets" / "minigames"
SHEET_DIR = ASSET_DIR / "cartoon-element-sheets"


@dataclass(frozen=True)
class Slot:
    asset_id: str
    box: tuple[float, float, float, float]


def rows(*rows_: tuple[str, ...], y_edges: tuple[float, ...] | None = None) -> tuple[Slot, ...]:
    if y_edges is None:
        y_edges = tuple(index / len(rows_) for index in range(len(rows_) + 1))
    slots: list[Slot] = []
    for row_index, row in enumerate(rows_):
        for column_index, asset_id in enumerate(row):
            slots.append(
                Slot(
                    asset_id,
                    (
                        column_index / len(row),
                        y_edges[row_index],
                        (column_index + 1) / len(row),
                        y_edges[row_index + 1],
                    ),
                )
            )
    return tuple(slots)


def slot(asset_id: str, box: tuple[float, float, float, float]) -> Slot:
    return Slot(asset_id, box)


SPECS: dict[str, tuple[Slot, ...]] = {
    "ms-10": rows(
        ("트렌치_굴착완료", "배관_자재", "전선관_자재", "간섭점_마킹"),
        ("되메움_모래", "마감_타일", "미확인_배관", "구두지시_메모"),
    ),
    "sns-01": rows(
        ("견본_표준_카드뉴스", "카드1_타이틀블록", "카드2_본문글자블록"),
        ("카드2_이미지영역", "카드3_로고영역", "카드4_상단색면"),
        ("카드4_이미지영역", "카드5_로고영역", "카드5_하단문구블록"),
    ),
    "stn-01": rows(
        ("손님_말풍선_네이비_별", "손님_말풍선_민트_새싹", "손님_말풍선_보라_달", "손님_말풍선_옐로_해", "손님_말풍선_코랄_물결", "휴지통"),
        ("시안_네이비_별", "시안_민트_새싹", "시안_옐로_해", "시안_코랄_물결"),
        ("시안_코랄_물결_워터마크", "시안_형광레드_별_금지마크"),
    ),
    "stn-02": rows(
        ("입구_표지", "소품_진열대", "회화_액자"),
        ("설치_구조물",),
        ("영상_스크린", "출구_표지", "적치물_상자더미"),
        y_edges=(0.0, 0.34, 0.67, 1.0),
    ),
    "stn-03": rows(
        ("매출탱크_열쇠_톱니A", "매출탱크_열쇠_둥근B", "매출탱크_열쇠_각진C", "매출탱크_열쇠_이중D", "매출탱크_열쇠_반투명"),
        ("CRM탱크_열쇠_톱니A", "CRM탱크_열쇠_둥근B", "CRM탱크_열쇠_각진C", "CRM탱크_열쇠_이중D", "CRM탱크_열쇠_톱니A_유사"),
        ("구슬_파랑", "구슬_짙은파랑", "구슬_옅은파랑", "구슬_파랑_광택"),
        ("구슬_붉은", "구슬_노란"),
    ),
    "stn-04": rows(
        ("조건카드_세모_파랑", "조건카드_네모_주황", "조건카드_동그라미_초록", "조건카드_마름모_보라"),
        ("결과카드_세모_파랑_상승", "결과카드_네모_주황_하락", "결과카드_동그라미_초록_상승", "결과카드_마름모_보라_평탄"),
        ("결과카드_별_빨강_역상승",),
    ),
    "stn-05": rows(
        ("근거카드_말풍선_노랑", "근거카드_마이크_파랑", "근거카드_화면화살표_보라"),
        ("막개_말풍선_노랑", "막개_마이크_파랑", "막개_화면화살표_보라"),
        ("막개_왕관_금테", "막개_과녁_회색"),
    ),
    "wh-01": rows(
        ("택배_파랑바코드", "택배_파랑바코드_2", "택배_초록바코드"),
        ("택배_주황바코드", "택배_C라벨_파랑바코드", "택배_A라벨_주황바코드"),
        ("택배_젖은박스_누출자국",),
    ),
    "yg-01": (
        slot("견본_표준_배너", (0.00, 0.04, 0.31, 0.58)),
        slot("시안A_로고부", (0.29, 0.05, 0.49, 0.29)),
        slot("시안A_상단색면", (0.48, 0.08, 0.73, 0.27)),
        slot("시안A_포인트색면", (0.73, 0.08, 0.99, 0.28)),
        slot("시안A_본문이미지", (0.28, 0.27, 0.54, 0.54)),
        slot("시안B_상단심볼", (0.52, 0.28, 0.72, 0.52)),
        slot("시안C_우상단요소", (0.68, 0.25, 1.00, 0.58)),
        slot("시안B_좌측버튼", (0.00, 0.55, 0.33, 0.76)),
        slot("시안B_우측버튼", (0.29, 0.55, 0.62, 0.76)),
        slot("시안C_중앙배경면", (0.61, 0.51, 0.98, 0.80)),
        slot("시안C_하단여백", (0.53, 0.75, 0.99, 0.94)),
    ),
    "yg-02": (
        slot("반지_도안일치", (0.00, 0.00, 0.50, 0.29)),
        slot("반지_보석세팅_기욺", (0.50, 0.00, 1.00, 0.29)),
        slot("목걸이_보석_허용오차내", (0.00, 0.27, 0.50, 0.55)),
        slot("목걸이_연결부_용접끊김", (0.50, 0.27, 1.00, 0.55)),
        slot("목걸이_도안_판독불가", (0.15, 0.52, 0.85, 0.75)),
        slot("브로치_도안일치", (0.00, 0.73, 0.50, 1.00)),
        slot("브로치_고정핀_용접끊김", (0.50, 0.73, 1.00, 1.00)),
    ),
    "yg-04": rows(
        ("게이트웨이_라우터", "추론서버_랙"),
        ("모델저장소_디스크", "DB_실린더"),
    ),
    "ys-01": rows(
        ("배차마커_순찰차", "배차마커_지원요청", "배차마커_예약"),
        ("신고_흉기난동", "신고_주취폭행", "신고_주차시비", "신고_자전거절도", "신고_위치미특정"),
    ),
    "ys-02": rows(
        ("초소_엄폐_정지수신호", "손들어_수신호", "암구호_문어패"),
        ("암구호_답어대조", "무전기_보고", "야간투시경_관측"),
        ("차단봉_개방", "초소밖_추격", "초소_비움", "상황일지_종결도장"),
    ),
    "ys-03": rows(
        ("입장객_얼굴_A", "입장객_얼굴_B", "입장객_얼굴_C", "입장객_얼굴_D", "입장객_얼굴_E"),
        ("출입증_초상_A", "출입증_초상_B", "출입증_초상_C", "출입증_초상_E", "출입증_초상_미상"),
    ),
    "ys-04": rows(("공기호흡기_본체", "무전기_보고"),),
    "ys-05": rows(
        ("슬래브_개구부_뚫림", "슬래브_개구부_덮개깨짐", "슬래브_개구부_덮개정상"),
        ("비계_난간없음", "비계_난간설치"),
        ("작업자_안전대없음", "작업자_맨머리", "작업자_안전모착용"),
        ("가설전선_피복벗겨짐_물웅덩이", "소화기_정위치"),
    ),
    "ys-06": rows(("분전반_회로_외관", "임시배선_새회로_외관"),),
    "ys-07": rows(("토크렌치_드레인플러그",),),
    "ys-08": rows(
        ("비상발전기_본체", "공기압축기_본체"),
        ("냉각수펌프_본체", "배전반_본체"),
        ("하역장비_본체",),
    ),
    "ys-09": (
        slot("드론_기체_정면", (0.00, 0.00, 0.50, 0.33)),
        slot("드론_기체_측면", (0.50, 0.00, 1.00, 0.33)),
        slot("게이트_프로펠러_분리", (0.00, 0.30, 1.00, 0.69)),
        slot("교란_지그_재조정", (0.00, 0.66, 0.45, 1.00)),
        slot("교란_케이블_당김", (0.35, 0.66, 0.76, 1.00)),
        slot("비행투입_요청카드", (0.72, 0.66, 1.00, 1.00)),
    ),
    "ys-10": rows(
        ("PTW_대장", "차단기_상태창_눈아이콘", "LOTO_자물쇠표지"),
        ("검전기", "작업중지_손신호", "무전기_보고"),
        ("차단기_레버_손아이콘", "배전반_단자", "작업자_재촉"),
    ),
}


def checker_alpha(rgb: np.ndarray) -> np.ndarray:
    """Turn the flattened checkerboard into a clean outlined silhouette mask.

    The illustrations all have a closed dark cartoon outline.  Near-white,
    near-neutral pixels are therefore treated as background seeds, while the
    closed outline is filled back in so white paper, metal and eye highlights
    remain opaque.  Filling external contours also removes checker texture
    from the interior of rings and key sockets instead of leaving gray noise.
    """
    value_min = rgb.min(axis=2)
    chroma = rgb.max(axis=2).astype(np.int16) - value_min.astype(np.int16)
    foreground_seed = np.where((value_min < 225) | (chroma > 12), 255, 0).astype(np.uint8)
    foreground_seed = cv2.morphologyEx(
        foreground_seed,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )
    contours, _ = cv2.findContours(foreground_seed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    silhouette = np.zeros_like(foreground_seed)
    for contour in contours:
        if cv2.contourArea(contour) >= 80:
            cv2.drawContours(silhouette, (contour,), -1, 255, thickness=cv2.FILLED)
    return cv2.GaussianBlur(silhouette, (0, 0), 0.55)


def clean_neutral_fill(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Replace checker-colored pixels enclosed by an object with clean ivory."""
    cleaned = rgb.copy()
    value_min = rgb.min(axis=2)
    chroma = rgb.max(axis=2).astype(np.int16) - value_min.astype(np.int16)
    enclosed_checker = (alpha > 20) & (value_min >= 225) & (chroma <= 12)
    # Preserve a tiny amount of original luminance so white surfaces still
    # have volume, but remove the alternating gray-square pattern.
    luminance = np.clip(value_min.astype(np.int16), 241, 250).astype(np.uint8)
    cleaned[enclosed_checker, 0] = luminance[enclosed_checker]
    cleaned[enclosed_checker, 1] = luminance[enclosed_checker]
    cleaned[enclosed_checker, 2] = np.maximum(luminance[enclosed_checker] - 2, 0)
    return cleaned


def isolated_content(
    alpha: np.ndarray,
    region: tuple[int, int, int, int],
    padding: int = 12,
) -> tuple[tuple[int, int, int, int], np.ndarray]:
    """Keep the intended components and discard slivers leaking from a neighbor."""
    x0, y0, x1, y1 = region
    sample = alpha[y0:y1, x0:x1]
    mask = np.where(sample > 40, 255, 0).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    if count <= 1:
        raise ValueError(f"No visible content in region {region}")
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = int(areas.max())
    kept = np.zeros_like(mask)
    for component in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[component])
        touches_edge = x <= 1 or y <= 1 or x + width >= mask.shape[1] - 1 or y + height >= mask.shape[0] - 1
        if area < max(70, round(largest * 0.04)):
            continue
        if touches_edge and area < largest * 0.30:
            continue
        kept[labels == component] = 255
    ys, xs = np.where(kept > 0)
    if not len(xs):
        raise ValueError(f"No visible content in region {region}")
    box = (
        max(x0, x0 + int(xs.min()) - padding),
        max(y0, y0 + int(ys.min()) - padding),
        min(x1, x0 + int(xs.max()) + padding + 1),
        min(y1, y0 + int(ys.max()) + padding + 1),
    )
    bx0, by0, bx1, by1 = box
    isolated = kept[by0 - y0 : by1 - y0, bx0 - x0 : bx1 - x0]
    return box, isolated


def square_sprite(
    sheet: Image.Image,
    box: tuple[int, int, int, int],
    isolated: np.ndarray,
    size: int = 512,
) -> Image.Image:
    crop = sheet.crop(box)
    crop_alpha = np.asarray(crop.getchannel("A"), dtype=np.uint8)
    crop.putalpha(Image.fromarray(np.minimum(crop_alpha, isolated), "L"))
    max_content = size - 48
    scale = min(max_content / crop.width, max_content / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def save_webp(image: Image.Image, destination: Path, method: int = 2) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        image.save(temporary, "WEBP", lossless=True, quality=100, method=method, exact=True)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def process_game(game_id: str, force: bool, claimed: dict[str, str]) -> tuple[int, int]:
    source = SOURCE_DIR / game_id / f"{game_id}.png"
    if not source.exists():
        raise FileNotFoundError(source)
    rgb = np.asarray(Image.open(source).convert("RGB"))
    alpha = checker_alpha(rgb)
    rgb = clean_neutral_fill(rgb, alpha)
    rgba = np.dstack((rgb, alpha))
    sheet = Image.fromarray(rgba, "RGBA")
    sheet_destination = SHEET_DIR / f"{game_id}-cartoon-elements.webp"
    if not sheet_destination.exists():
        save_webp(sheet, sheet_destination)

    written = 0
    skipped = 0
    height, width = alpha.shape
    for item in SPECS[game_id]:
        # The radio is shared by three YAMLs.  ys-04 is the clean, large master.
        if item.asset_id == "무전기_보고" and game_id != "ys-04":
            skipped += 1
            continue
        previous = claimed.get(item.asset_id)
        if previous and previous != game_id:
            raise ValueError(f"Duplicate asset {item.asset_id}: {previous}, {game_id}")
        claimed[item.asset_id] = game_id
        x0, y0, x1, y1 = item.box
        region = (round(x0 * width), round(y0 * height), round(x1 * width), round(y1 * height))
        box, isolated = isolated_content(alpha, region)
        destination = ASSET_DIR / f"{item.asset_id}.webp"
        if destination.exists() and not force:
            skipped += 1
            continue
        save_webp(square_sprite(sheet, box, isolated), destination)
        written += 1
    return written, skipped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="overwrite existing runtime WebP files")
    parser.add_argument("--game", choices=tuple(SPECS), help="process only one game")
    args = parser.parse_args()

    claimed: dict[str, str] = {}
    written = skipped = 0
    games = (args.game,) if args.game else tuple(SPECS)
    for game_id in games:
        game_written, game_skipped = process_game(game_id, args.force, claimed)
        written += game_written
        skipped += game_skipped
        print(f"{game_id}: assets={len(SPECS[game_id])} written={game_written} skipped={game_skipped}")
    print(f"games={len(games)} unique_assets={len(claimed)} written={written} skipped={skipped}")


if __name__ == "__main__":
    main()
