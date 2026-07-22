"""Split generated minigame cartoon sheets into runtime-ready PNG sprites.

The sheet order is intentionally explicit: it is the bridge between the art
review sheets and the sprite ids already referenced by the minigame YAML files.
No gameplay data is changed by this script.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "apps" / "web" / "public" / "assets" / "minigames"
SHEET_DIR = ASSET_DIR / "cartoon-element-sheets"


@dataclass(frozen=True)
class SheetSpec:
    rows: tuple[tuple[str, ...], ...]
    manual_grid: bool = False

    @property
    def items(self) -> tuple[str, ...]:
        return tuple(item for row in self.rows for item in row)


SHEETS: dict[str, SheetSpec] = {
    "cln-01": SheetSpec(
        (
            ("낙서된_메모지", "새_메모지", "새_시트", "생수"),
            ("세제통", "침대시트_갈색얼룩", "침대시트_이물질", "컵_미세균열"),
            ("컵_정상", "타월_대", "타월_소", "타월_중"),
            ("투숙객_소지품", "펜"),
        )
    ),
    "gm-01": SheetSpec(
        (
            ("팔레트_빨강_보류", "팔레트_초록", "포장박스_다른규격"),
            ("포장박스_모퉁이젖음", "포장박스_정상", "포장박스_찌그러짐"),
        )
    ),
    "hr-01": SheetSpec(
        (
            ("기출질문_목록", "노트북", "빔프로젝터", "안내표지판"),
            ("이력서묶음", "지원자파일_공용사본", "평가표"),
        )
    ),
    "jm-01": SheetSpec(
        (
            ("물웅덩이", "배송지_건물", "배송지_파손주의", "배송트럭_톱다운"),
            ("어린이보호구역_표지", "장애물_라바콘", "장애물_차량", "종점_창고"),
        )
    ),
    "jm-02": SheetSpec(
        (
            ("102노선_주행뷰", "건널목_경보"),
            ("방호버튼_점멸", "서행표지_황", "승인신호_녹"),
            ("제동시험_표지", "정상주행표지_녹", "판정선_열차", "해제표지_녹"),
            ("출발표지_녹",),
        )
    ),
    "jm-03": SheetSpec(
        (
            ("엔진흡입구_이물질", "엔진흡입구_청결"),
            ("조종면_결빙", "조종면_결빙없음"),
            ("타이어_마모", "타이어_정상"),
            ("피토관_커버부착", "피토관_커버제거됨"),
        )
    ),
    "jm-04": SheetSpec((("변침점_부표", "운항선박_톱다운", "정박지_부두"),)),
    "jm-05": SheetSpec((("양중_화물_철골",), ("착지_목표패드",))),
    "kts-01": SheetSpec(
        (
            ("사과_처리안내", "원무팀장_호출", "접수기록_대조"),
            ("환자_가슴움켜쥠_식은땀", "환자_문진표_공란", "환자_문진표_작성중"),
            ("환자_부축_지팡이", "환자_접수대막음_고성", "환자_진료카드_보유"),
        )
    ),
    "kts-02": SheetSpec(
        (
            ("동작_대체_무릎보호", "동작_대체_허리보호", "동작_리포머_기초", "동작_리포머_중급"),
            ("동작_매트_기초", "동작_점프보드_고강도", "동작_점프보드_중급", "동작_후굴_고강도"),
            ("회원_중급_제약없음", "회원_중급_허리보호", "회원_초급_무릎보호", "회원_초급_제약없음"),
        )
    ),
    "kts-03": SheetSpec(
        (
            ("교환_적립_안내", "구매이력_조회", "니즈_기념일_스파클링", "니즈_부모님_레드"),
            ("니즈_승진_레드선호", "니즈_집들이_화이트", "니즈_초보_스위트", "손님_개봉상품_고성"),
            ("와인_레드_고가", "와인_레드_중가", "와인_레드_품절", "와인_레드_프리미엄"),
            ("와인_스위트_저가", "와인_스파클링_중가", "와인_화이트_저가", "환불규정_안내"),
        )
    ),
    "kts-04": SheetSpec(
        (
            ("번호표_절차안내", "손님_상담희망", "손님_새치기_고성", "손님_서류_한장"),
            ("손님_서류뭉치", "손님_조용_봉투", "손님_통장_재촉_큰소리", "용건_소요시간"),
        ),
        manual_grid=True,
    ),
    "kts-05": SheetSpec(
        (
            ("객실키_금색", "객실키_초록", "객실키_파랑", "손님_갈색머리", "손님_금발_안경"),
            ("손님_안경_흑발", "손님_흑발_오른뺨점", "손님_모자_흑발"),
            ("여권_갈색머리", "여권_금발_안경", "여권_안경_흑발", "여권_흑발_모자없음"),
            ("여권_흑발_오른뺨점", "여권_흑발_콧수염"),
        )
    ),
    "ms-01": SheetSpec(
        (
            ("문서_겹친아이콘", "문서_계약서아이콘", "문서_계약서아이콘_리본없음", "문서_계약서아이콘_빨간리본", "문서_계약서아이콘_수정본"),
            ("문서_라벨빈칸", "문서_라벨찢김", "문서_메모지아이콘", "문서_발송대기_개인정보도장", "문서_봉투아이콘"),
            ("보완요청_트레이", "캐비닛_계약서", "캐비닛_메모", "캐비닛_원본잠금", "캐비닛_이메일"),
        )
    ),
    "ms-02": SheetSpec(
        (
            ("영수증_사각_보라", "영수증_사각_주황", "영수증_사각_파랑", "영수증_삼각_보라", "영수증_삼각_주황", "영수증_삼각_초록"),
            ("영수증_삼각_파랑", "영수증_원형_보라", "영수증_원형_주황", "영수증_원형_초록", "영수증_원형_파랑", "영수증_육각_초록", "영수증_육각_파랑"),
            ("영수증_육각_주황", "카드전표_사각_보라", "카드전표_사각_주황", "카드전표_사각_초록", "카드전표_사각_파랑", "카드전표_삼각_보라", "카드전표_삼각_주황"),
            ("카드전표_삼각_초록", "카드전표_삼각_파랑", "카드전표_원형_보라", "카드전표_원형_주황", "카드전표_원형_초록", "카드전표_원형_파랑"),
            ("카드전표_육각_주황", "카드전표_육각_초록", "카드전표_육각_파랑"),
        )
    ),
    "ms-03": SheetSpec(
        (
            ("금색_의자", "명패_노랑", "명패_빨강", "명패_초록", "명패_파랑"),
            ("배너_행사용", "자료_금배지_최신", "자료_노랑_최신", "자료_빨강_최신", "자료_초록_구버전"),
            ("자료_초록_최신", "자료_파랑_구버전", "자료_파랑_최신"),
            ("진행자_금배지", "참석자_노랑", "참석자_빨강", "참석자_초록", "참석자_파랑", "참석자_회색_불참"),
        )
    ),
    "ms-04": SheetSpec(
        (
            ("배차트럭_달", "배차트럭_별", "배차트럭_산", "배차트럭_해"),
            ("상자_달아이콘_도장달", "상자_별아이콘_도장달", "상자_별아이콘_도장별", "상자_별아이콘_초대형"),
            ("상자_산아이콘_도장산", "상자_세관도장_확인요청", "상자_해아이콘_도장산", "상자_해아이콘_도장해"),
            ("팔레트_빨강_보류",),
        )
    ),
    "ms-05": SheetSpec(
        (
            ("제품_균열", "제품_변색", "제품_정상", "제품_정상_도장있음"),
            ("제품_정상_물기", "제품_정상_조명반사", "제품_정상외관_도장없음", "제품_찌그러짐"),
        )
    ),
    "ms-06": SheetSpec(
        (
            ("가축_성체", "가축_어린개체"),
            ("가축_임신개체", "가축_회복개체"),
            ("구유_나무", "사료포대_삽"),
        )
    ),
    "ms-07": SheetSpec(
        (
            ("손세정_소독", "재료_감자", "재료_기한경과"),
            ("재료_당근", "재료_마늘", "재료_무름"),
            ("재료_양파", "재료_온도이탈", "재료_이물혼입"),
            ("칼_도마_교체", "판정선_칼날"),
        )
    ),
    "ms-08": SheetSpec(
        (
            ("두피_발적_아이콘", "두피_상처_아이콘", "사람_커트_가이드라인"),
            ("움찔_모션_아이콘", "자세고침_아이콘", "커트가위_커서"),
            ("패치테스트_확인카드",),
        ),
        manual_grid=True,
    ),
    "ms-09": SheetSpec(
        (
            ("균열라인_연기_아이콘", "스파크_이펙트"),
            ("절삭_경로_최신본", "절삭헤드_커터"),
        ),
        manual_grid=True,
    ),
}


def alpha_bbox(image: Image.Image, region: tuple[int, int, int, int], padding: int = 10) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = region
    alpha = np.asarray(image.getchannel("A"))[y0:y1, x0:x1]
    ys, xs = np.where(alpha > 16)
    if not len(xs):
        raise ValueError(f"No visible pixels in region {region}")
    left = max(x0, x0 + int(xs.min()) - padding)
    top = max(y0, y0 + int(ys.min()) - padding)
    right = min(x1, x0 + int(xs.max()) + padding + 1)
    bottom = min(y1, y0 + int(ys.max()) + padding + 1)
    return left, top, right, bottom


def manual_boxes(game_id: str, image: Image.Image, spec: SheetSpec) -> list[tuple[int, int, int, int]]:
    width, height = image.size
    if game_id == "ms-08":
        # The scissors extend left of the equal-width third cell while the rear
        # head reaches slightly below the equal-height first row. These art-led
        # boundaries keep both sprites intact without leaking into each other.
        regions = (
            (0, 0, 420, 445),
            (420, 0, 840, 445),
            (840, 0, width, 445),
            (0, 445, 430, 900),
            (430, 445, 780, 900),
            (780, 445, width, 900),
            (0, 900, width, height),
        )
        return [alpha_bbox(image, region) for region in regions]
    boxes: list[tuple[int, int, int, int]] = []
    for row_index, row in enumerate(spec.rows):
        y0 = round(height * row_index / len(spec.rows))
        y1 = round(height * (row_index + 1) / len(spec.rows))
        for column_index in range(len(row)):
            x0 = round(width * column_index / len(row))
            x1 = round(width * (column_index + 1) / len(row))
            boxes.append(alpha_bbox(image, (x0, y0, x1, y1)))
    return boxes


def detected_boxes(image: Image.Image, spec: SheetSpec) -> list[tuple[int, int, int, int]]:
    alpha = np.asarray(image.getchannel("A"))
    mask = np.where(alpha > 32, 255, 0).astype(np.uint8)
    radius = 8
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.dilate(mask, kernel, iterations=1)
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask)
    components: list[tuple[float, float, tuple[int, int, int, int]]] = []
    for index in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[index])
        if area <= 300:
            continue
        region = (x, y, x + width, y + height)
        components.append((float(centroids[index][0]), float(centroids[index][1]), alpha_bbox(image, region)))

    if len(components) != len(spec.items):
        raise ValueError(f"Detected {len(components)} elements, expected {len(spec.items)}")

    # The generated sheets have clearly separated horizontal bands. Sorting by
    # vertical center and taking the declared row sizes avoids depending on OCR
    # or fragile assumptions about the object silhouette.
    components.sort(key=lambda component: component[1])
    boxes: list[tuple[int, int, int, int]] = []
    offset = 0
    for row in spec.rows:
        row_components = components[offset : offset + len(row)]
        row_components.sort(key=lambda component: component[0])
        boxes.extend(component[2] for component in row_components)
        offset += len(row)
    return boxes


def square_sprite(image: Image.Image, box: tuple[int, int, int, int], size: int = 512) -> Image.Image:
    crop = image.crop(box)
    alpha = crop.getchannel("A")
    if alpha.getbbox() is None:
        raise ValueError(f"Empty crop for {box}")
    max_content = size - 48
    scale = min(max_content / crop.width, max_content / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def split_sheet(game_id: str, spec: SheetSpec, force: bool, skip_assets: set[str] | None = None) -> list[Path]:
    sheet_path = SHEET_DIR / f"{game_id}-cartoon-elements.webp"
    if not sheet_path.exists():
        raise FileNotFoundError(sheet_path)
    image = Image.open(sheet_path).convert("RGBA")
    boxes = manual_boxes(game_id, image, spec) if spec.manual_grid else detected_boxes(image, spec)
    if len(boxes) != len(spec.items):
        raise ValueError(f"{game_id}: {len(boxes)} boxes for {len(spec.items)} items")

    written: list[Path] = []
    for asset_id, box in zip(spec.items, boxes, strict=True):
        if skip_assets and asset_id in skip_assets:
            continue
        destination = ASSET_DIR / f"{asset_id}.webp"
        if destination.exists() and not force:
            continue
        temporary = destination.with_suffix(".webp.tmp")
        try:
            square_sprite(image, box).save(
                temporary,
                "WEBP",
                lossless=True,
                quality=100,
                method=4,
                exact=True,
            )
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        legacy_png = ASSET_DIR / f"{asset_id}.png"
        if legacy_png.exists():
            legacy_png.unlink()
        written.append(destination)
    return written


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Overwrite existing generated WebP sprites")
    parser.add_argument("--game", choices=tuple(SHEETS), help="Split only one game sheet")
    args = parser.parse_args()

    all_items: dict[str, str] = {}
    written: list[Path] = []
    for game_id, spec in SHEETS.items():
        if args.game and game_id != args.game:
            for item in spec.items:
                all_items.setdefault(item, game_id)
            continue
        duplicates = {item for item in spec.items if item in all_items}
        # Shared assets use the first generated master (currently the hold
        # pallet shared by gm-01 and ms-04). Detection still sees every cell;
        # only the duplicate write is skipped.
        written.extend(split_sheet(game_id, spec, args.force, duplicates))
        for item in spec.items:
            all_items.setdefault(item, game_id)

    processed = 1 if args.game else len(SHEETS)
    print(f"games={processed} unique_assets={len(all_items)} written={len(written)}")


if __name__ == "__main__":
    main()
