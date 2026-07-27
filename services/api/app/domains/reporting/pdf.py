"""리포트 PDF 렌더링 — reportlab + Pretendard 임베드 (뷰어 무관하게 한글 표시).

디자인(2026-07-26 개편 v2): 고용센터/상담센터에 제출해도 손색없는 '직업심리검사'급
직무 적합도 리포트를 목표로 한다. 앱 브랜드 팔레트(퍼플 #8a63ee → 핑크 #ef71bc)를 입혀
- 상단 그라디언트 배너(제목·대상자)
- 종합 적합도 히어로 카드(상담+체험 합산 지표임을 라벨로 명시 → 직무 적합도와 혼동 방지)
- 추천 직무 표: 컬러 헤더 + 적합도 막대 + 같은 계열 직업 예시(리포지토리 매핑) + 지표 설명 주석
- 역량 레이더 차트(SpiderChart) + 강점 프로필 표(밴드 라벨) — 텍스트보다 시각 위주
- 섹션마다 'AI 해석' 카드(그 섹션의 수치·발화에 근거) — 데이터 없으면 생략
- 미션별 AI 평가 블록(실제 미션 로그가 있을 때만)
- 강점/보완점: 출처 태그 칩([체험]/[상담]/[소감]) + 좌측 컬러 보더 카드
- 체험 소감 + AI 코칭 피드백(소감이 있을 때만)
- 직무 마스터의 종합 총평(여러 문단) + 직무 기본 정보 + 다음 단계 CTA

원칙: 모든 서술은 실제 리포지토리 데이터/사용자 본인의 말에 근거하며, 데이터가 없는
섹션은 지어내지 않고 통째로 생략한다(한 사람의 진로 데이터이므로 날조 금지).
Regular/SemiBold/Bold TTF를 임베드해 크기+굵기+색으로 위계를 준다.
"""

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.graphics.charts.spider import SpiderChart
from reportlab.graphics.shapes import Drawing
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# ── 폰트: Pretendard 3종(Regular/SemiBold/Bold) 임베드 + 패밀리 등록 ──────────
FONT = "Pretendard"
FONT_SB = "Pretendard-SemiBold"
FONT_B = "Pretendard-Bold"
_FONTS = Path(__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont(FONT, str(_FONTS / "Pretendard-Regular.ttf")))
pdfmetrics.registerFont(TTFont(FONT_SB, str(_FONTS / "Pretendard-SemiBold.ttf")))
pdfmetrics.registerFont(TTFont(FONT_B, str(_FONTS / "Pretendard-Bold.ttf")))
# Paragraph의 <b> 마크업이 Bold TTF로 매핑되도록 패밀리로 묶는다(합성 볼드 미사용).
pdfmetrics.registerFontFamily(
    FONT, normal=FONT, bold=FONT_B, italic=FONT, boldItalic=FONT_B
)

# ── 브랜드 팔레트 (apps/web --scenario-accent 계열) ──────────────────────────
PRIMARY = HexColor(0x6C4BEF)    # 본문·헤딩용 딥 퍼플(대비 확보)
PRIMARY_L = HexColor(0x8A63EE)  # 브랜드 퍼플(배너 그라디언트 시작)
ACCENT = HexColor(0xEF71BC)     # 브랜드 핑크(배너 그라디언트 끝·포인트)
INK = HexColor(0x2A2540)        # 본문 텍스트
MUTED = HexColor(0x8B86A0)      # 캡션·보조
LAVENDER = HexColor(0xF4F1FE)   # 카드·히어로 배경
LAV_ALT = HexColor(0xFBFAFF)    # 표 교차 행·해석 카드 배경
BORDER = HexColor(0xE6E0FA)     # 헤어라인
TRACK = HexColor(0xE9E3FB)      # 막대 트랙·레이더 스포크
GOOD = HexColor(0x179A6B)       # 강점(초록)
GOOD_BG = HexColor(0xEAF7F1)
WARN = HexColor(0xC77A12)       # 보완점(앰버)
WARN_BG = HexColor(0xFBF2E3)
HEADER_TINT = HexColor(0xF0E9FF)  # 배너 서브텍스트
# 레이더 실측 폴리곤 반투명 채움(윤곽은 PRIMARY, 면은 옅게)
PRIMARY_FILL = Color(PRIMARY.red, PRIMARY.green, PRIMARY.blue, 0.20)

# 강점/보완점 출처 태그 → (글자색, 배경색). 프롬프트가 각 항목 앞에 [체험]/[상담]/[소감]을 붙인다.
# 체험은 중립 슬레이트그레이 — 초록(강점)·앰버(보완점) 박스, 핑크(상담)·초록(소감) 칩
# 어디에도 튀지 않게 한다(브랜드 퍼플은 초록/앰버 배경에서 부딪혀 보였다).
TAG_STYLES = {
    "체험": (HexColor(0x4B5768), HexColor(0xEDF0F5)),
    "상담": (HexColor(0xC13B8B), HexColor(0xFCEAF4)),
    "소감": (HexColor(0x179A6B), HexColor(0xE7F6EF)),
}
_TAG_RE = re.compile(r"^\s*\[([^\]]{1,6})\]\s*(.*)$", re.S)

_title = ParagraphStyle("title", fontName=FONT_B, fontSize=20, leading=26, spaceAfter=4)
_body = ParagraphStyle("body", fontName=FONT, fontSize=10, leading=16, textColor=INK)
_muted = ParagraphStyle("muted", fontName=FONT, fontSize=8.5, leading=12.5, textColor=MUTED)
_th = ParagraphStyle("th", fontName=FONT_SB, fontSize=9.5, leading=12, textColor=white)
_cell = ParagraphStyle("cell", fontName=FONT, fontSize=9.5, leading=14, textColor=INK)
_cell_sb = ParagraphStyle("cellsb", fontName=FONT_SB, fontSize=9.5, leading=14, textColor=INK)
_cell_muted = ParagraphStyle("cellm", fontName=FONT, fontSize=8.5, leading=12, textColor=MUTED)
_rank = ParagraphStyle("rank", fontName=FONT_B, fontSize=13, leading=15, textColor=PRIMARY, alignment=TA_CENTER)
_score = ParagraphStyle("score", fontName=FONT_SB, fontSize=12, leading=13, textColor=PRIMARY, alignment=TA_CENTER)
_hero_num = ParagraphStyle("heronum", fontName=FONT_B, fontSize=36, leading=38, textColor=PRIMARY)
_hero_lbl = ParagraphStyle("herolbl", fontName=FONT_SB, fontSize=10, leading=14, textColor=MUTED)
_card = ParagraphStyle("card", fontName=FONT, fontSize=10, leading=16, textColor=INK)
_quote = ParagraphStyle("quote", fontName=FONT, fontSize=9.5, leading=15.5, textColor=INK)


COMPETENCY_NAMES = {
    "situation_judgment": "상황 판단력",
    "problem_solving": "문제해결력",
    "communication": "커뮤니케이션",
    "collaboration": "협업",
    "task_management": "업무 관리",
}


def _clamp(v) -> int:
    try:
        return max(0, min(100, int(v)))
    except (TypeError, ValueError):
        return 0


def _band(v: int):
    """점수 → (밴드 라벨, 색). 직업심리검사식 '수준' 표기."""
    if v >= 80:
        return "매우 우수", GOOD
    if v >= 65:
        return "우수", PRIMARY
    if v >= 50:
        return "보통", MUTED
    return "개발 필요", WARN


def _paragraphs(text: str, style: ParagraphStyle) -> list:
    """빈 줄로 구분된 여러 문단을 각각의 Paragraph로 — 긴 총평의 문단 구분 유지."""
    parts = [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]
    out: list = []
    for i, p in enumerate(parts):
        out.append(Paragraph(p.replace("\n", "<br/>"), style))
        if i < len(parts) - 1:
            out.append(Spacer(1, 6))
    return out or [Paragraph((text or "-").strip() or "-", style)]


def _bar(score: int, width_mm: float = 20, height: float = 5,
         color: colors.Color = PRIMARY) -> Table:
    """점수(0~100) 비율 막대 — 표 셀 안에 넣는 미니 진행바."""
    s = _clamp(score)
    full = width_mm * mm
    fw = full * s / 100.0
    t = Table([["", ""]], colWidths=[fw, full - fw], rowHeights=[height])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), color),
        ("BACKGROUND", (1, 0), (1, 0), TRACK),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _section(title: str, accent: colors.Color = ACCENT) -> Table:
    """섹션 제목 — 좌측 컬러 바 + 제목. 표로 만들어 정렬을 고정한다."""
    t = Table(
        [["", Paragraph(title, ParagraphStyle(
            "sec", fontName=FONT_B, fontSize=13, leading=16, textColor=PRIMARY))]],
        colWidths=[3.2 * mm, None],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), accent),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 0),
        ("LEFTPADDING", (1, 0), (1, 0), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _insight_card(text: str, label: str = "AI 해석") -> Table:
    """섹션 해석 카드 — 'AI 해석' 라벨 + 서술. 이 섹션의 수치/발화에 근거한 해설임을 시각적으로 명시.

    텍스트가 비어 있으면 None을 반환해 호출부에서 통째로 생략하게 한다(날조 금지).
    """
    if not (text or "").strip():
        return None
    head = Paragraph(
        f'◆ {label}',
        ParagraphStyle("ihead", fontName=FONT_B, fontSize=9, leading=12, textColor=PRIMARY))
    rows = [[head], [Spacer(1, 3)]]
    rows += [[p] for p in _paragraphs(text, _card)]
    t = Table(rows, colWidths=[None], cornerRadii=[6, 6, 6, 6])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LAV_ALT),
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (0, 0), 9),
        ("BOTTOMPADDING", (0, -1), (0, -1), 9),
    ]))
    return t


def _chip(tag: str) -> Table:
    """출처 태그 칩(체험/상담/소감) — 색 배경 둥근 알약."""
    fg, bg = TAG_STYLES.get(tag, (MUTED, LAVENDER))
    p = Paragraph(tag, ParagraphStyle(
        "chip", fontName=FONT_SB, fontSize=8, leading=10, textColor=fg, alignment=TA_CENTER))
    t = Table([[p]], colWidths=[12 * mm], rowHeights=[6.2 * mm], cornerRadii=[3, 3, 3, 3])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return t


def _tagged_callout(items: list[str], *, bar_color: colors.Color,
                    bg: colors.Color) -> Table:
    """출처 태그 칩 + 항목 텍스트를 2열로. [태그]가 없으면 점(•)만 붙인다."""
    rows = []
    for s in items:
        m = _TAG_RE.match(s or "")
        if m:
            rows.append([_chip(m.group(1)), Paragraph(m.group(2), _card)])
        else:
            rows.append([Paragraph(
                f'<font color="#{bar_color.hexval()[2:]}">●</font>', _card),
                Paragraph(s or "-", _card)])
    inner = Table(rows or [[Paragraph("", _card), Paragraph("-", _card)]],
                  colWidths=[13.5 * mm, None])
    inner.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 5),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    card = Table([[inner]], colWidths=[None], cornerRadii=[5, 5, 5, 5])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return card


def _prose_card(text: str, *, bg: colors.Color = LAVENDER,
                bar: colors.Color = PRIMARY_L) -> Table:
    """여러 문단 서술을 담는 좌측 보더 카드(총평·CTA용)."""
    rows = [[p] for p in _paragraphs(text, _card)]
    card = Table(rows, colWidths=[None], cornerRadii=[6, 6, 6, 6])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (0, 0), 10),
        ("BOTTOMPADDING", (0, -1), (0, -1), 10),
    ]))
    return card


def _radar(measured: dict[str, int]) -> Drawing | None:
    """역량 레이더(거미줄) 차트 — 측정된 역량(≥3개)만 축으로. 미측정 축은 넣지 않는다.

    25/50/75/100 눈금 링을 옅은 격자(graticule)로 먼저 깔고 그 위에 실측 폴리곤을
    그린다. SpiderChart는 스포크별 최댓값(=100 링)에 맞춰 스케일하므로 눈금 링이
    있어야 값이 절대비율로 보이고, 실측을 '맨 위'에 그려야 링과 겹쳐 보이지 않는다
    (SpiderChart는 data 순서대로 겹쳐 그리므로 실측 시리즈를 마지막에 둔다).
    """
    if len(measured) < 3:
        return None
    labels = [COMPETENCY_NAMES.get(k, k) for k in measured]
    values = [_clamp(v) for v in measured.values()]
    n = len(labels)

    # 라벨을 폴리곤 바깥으로 넉넉히 빼기 위해 세로 여백을 키우고(위쪽 '상황 판단력'
    # 이 잘리지 않도록), labelRadius로 라벨을 그래프에서 크게 밀어낸다. 플롯을 살짝
    # 줄여(66mm) 라벨-폴리곤 사이 간격을 충분히 확보한다.
    dw, dh = 150 * mm, 104 * mm
    d = Drawing(dw, dh)
    sp = SpiderChart()
    sp.width = 66 * mm
    sp.height = 66 * mm
    sp.x = (dw - sp.width) / 2
    sp.y = (dh - sp.height) / 2
    # 격자 링(25·50·75·100)을 먼저, 실측 폴리곤을 맨 마지막에 → 실측이 위로 온다
    grid_rings = [25, 50, 75, 100]
    sp.data = [[g] * n for g in grid_rings] + [values]
    sp.labels = labels
    # 스포크 라벨을 폴리곤에서 멀찌감치(반지름 1.35배) 밖으로 빼 겹침을 확실히 없앤다.
    # 최고점(100) 꼭짓점이 반지름 1.0, 라벨은 1.35 → 실측값과 라벨 사이 여유가 충분하다.
    sp.spokes.labelRadius = 1.35
    sp.spokeLabels.fontName = FONT_SB
    sp.spokeLabels.fontSize = 8.5
    sp.spokeLabels.fillColor = INK
    sp.spokes.strokeColor = TRACK
    sp.spokes.strokeWidth = 0.5
    # 눈금 링 — 옅은 격자(내부 3개는 아주 옅게, 100 링만 약간 또렷하게)
    for i in range(len(grid_rings)):
        sp.strands[i].strokeColor = BORDER if grid_rings[i] == 100 else TRACK
        sp.strands[i].strokeWidth = 0.5
        sp.strands[i].fillColor = None
        sp.strands[i].symbol = None
    # 실측 폴리곤 — 맨 위, 굵은 퍼플 + 반투명 채움
    meas = len(grid_rings)
    sp.strands[meas].strokeColor = PRIMARY
    sp.strands[meas].strokeWidth = 2.0
    sp.strands[meas].fillColor = PRIMARY_FILL
    sp.strands[meas].symbol = None
    d.add(sp)
    d.hAlign = "CENTER"
    return d


def _mission_block(title: str, score, evaluation: str) -> Table:
    """미션 1건 — 제목 + 점수 배지 + AI 평가 텍스트. 실제 미션 로그가 있을 때만 호출."""
    badge = ""
    if score is not None:
        badge = (f'&nbsp;&nbsp;<font name="{FONT_SB}" color="#6C4BEF">'
                 f'{_clamp(score)}점</font>')
    head = Paragraph(f'<font name="{FONT_B}" color="#2A2540">{title}</font>{badge}',
                     ParagraphStyle("mh", fontName=FONT_B, fontSize=10.5, leading=14, textColor=INK))
    body = Paragraph(evaluation or "-", _card)
    card = Table([[head], [Spacer(1, 3)], [body]], colWidths=[None], cornerRadii=[5, 5, 5, 5])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LAV_ALT),
        ("LINEBEFORE", (0, 0), (0, -1), 3, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (0, 0), 9),
        ("BOTTOMPADDING", (0, -1), (0, -1), 9),
    ]))
    return card


def _ncs_info_card(edu_value, median_salary, salary_stats: dict, certs: list) -> Table:
    """직무 기본 정보 카드 — 라벤더 라운드 카드에 학력/연봉/자격증을 표 형태로.

    라벨 열은 퍼플 SemiBold, 값 열에 내용. 평균 연봉은 큰 퍼플 볼드로 강조하고
    조사 기준을 옅은 캡션으로 덧붙인다. 자격증은 알약(pill) 칩으로 나열한다.
    값이 있는 항목만 행으로 넣는다(없는 수치는 지어내지 않는다).
    """
    def _pill(name: str) -> Table:
        p = Paragraph(name, ParagraphStyle(
            "pill", fontName=FONT_SB, fontSize=8.5, leading=11,
            textColor=PRIMARY, alignment=TA_CENTER))
        t = Table([[p]], cornerRadii=[7, 7, 7, 7])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor(0xEDE7FE)),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        return t

    def _label(text: str) -> Paragraph:
        return Paragraph(text, ParagraphStyle(
            "ncslbl", fontName=FONT_SB, fontSize=9.5, leading=13, textColor=PRIMARY))

    rows: list = []
    if edu_value:
        rows.append([_label("학력 요건"), Paragraph(str(edu_value), _cell)])
    if median_salary:
        caption_parts = [p for p in (
            f"{salary_stats['reference_year']}년" if salary_stats.get("reference_year") else None,
            salary_stats.get("population"),
        ) if p]
        caption = (f'&nbsp;&nbsp;<font name="{FONT}" size="8" color="#8B86A0">'
                   f"({' · '.join(caption_parts)} 기준)</font>") if caption_parts else ""
        val = Paragraph(
            f'<font name="{FONT_B}" size="14" color="#6C4BEF">'
            f'{round(median_salary / 10000):,}만원</font>{caption}',
            ParagraphStyle("ncssal", fontName=FONT, fontSize=10, leading=18, textColor=INK))
        rows.append([_label("평균 연봉"), val])
    if certs:
        names = [c.get("name", "") for c in certs if c.get("name")]
        if names:
            chip_cells = [_pill(n) for n in names]
            chip_row = Table([chip_cells], colWidths=[None] * len(chip_cells))
            chip_row.setStyle(TableStyle([
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-2, -1), 5),
                ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]))
            rows.append([_label("관련 자격증"), chip_row])

    card = Table(rows, colWidths=[26 * mm, None], cornerRadii=[8, 8, 8, 8])
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), LAV_ALT),
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("LINEAFTER", (0, 0), (0, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]
    for i in range(len(rows) - 1):
        style.append(("LINEBELOW", (0, i), (-1, i), 0.5, BORDER))
    card.setStyle(TableStyle(style))
    return card


def _draw_page(canvas, doc):
    """공통 캔버스 장식 — 첫 페이지 그라디언트 배너 + 모든 페이지 푸터."""
    w, h = A4
    x0 = doc.leftMargin
    band_w = w - doc.leftMargin - doc.rightMargin

    if canvas.getPageNumber() == 1:
        band_h = 30 * mm
        y0 = h - doc.topMargin - band_h
        canvas.saveState()
        try:
            p = canvas.beginPath()
            p.roundRect(x0, y0, band_w, band_h, 6 * mm)
            canvas.clipPath(p, stroke=0, fill=0)
            canvas.linearGradient(
                x0, y0, x0 + band_w, y0, (PRIMARY_L, ACCENT), extend=True)
        except Exception:  # noqa: BLE001 — 그라디언트 미지원 시 단색 폴백
            canvas.setFillColor(PRIMARY_L)
            canvas.roundRect(x0, y0, band_w, band_h, 6 * mm, stroke=0, fill=1)
        canvas.restoreState()

        canvas.saveState()
        # 세 줄(카드라인·제목·부제)을 위→아래로 겹치지 않게 배치
        canvas.setFillColor(HEADER_TINT)
        canvas.setFont(FONT_SB, 9)
        canvas.drawString(x0 + 9 * mm, y0 + band_h - 7.5 * mm,
                          getattr(doc, "kicker", "AI 커리어 적합도 리포트"))
        canvas.setFillColor(white)
        canvas.setFont(FONT_B, 19)
        canvas.drawString(x0 + 9 * mm, y0 + band_h - 17 * mm,
                          getattr(doc, "report_title", "상담 결과 리포트"))
        canvas.setFillColor(HEADER_TINT)
        canvas.setFont(FONT, 9.5)
        canvas.drawString(x0 + 9 * mm, y0 + 6 * mm,
                          getattr(doc, "report_subtitle", ""))
        canvas.restoreState()

    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(x0, 16 * mm, w - doc.rightMargin, 16 * mm)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(x0, 12 * mm, "나의 직무 아카데미아 · AI 직무 적합도 리포트")
    canvas.drawRightString(w - doc.rightMargin, 12 * mm, str(canvas.getPageNumber()))
    canvas.restoreState()


def render_report_pdf(
    path: Path,
    *,
    user_name: str,
    recommendations: list[dict],
    fit_score: int,
    strengths: list[str],
    improvements: list[str],
    advice: str,
    performance: dict | None = None,
    percentile: dict | None = None,
    recommendation_insight: str | None = None,
    competency_insight: str | None = None,
    reflection_feedback: str | None = None,
    next_steps: str | None = None,
    mission_evaluations: list[dict] | None = None,
) -> None:
    mission_evaluations = mission_evaluations or []
    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
    )
    # 상담만으로 낸 것과 체험까지 반영한 것은 성격이 다르다 — 제목으로 구분한다.
    doc.report_title = "직무 체험 최종 리포트" if performance else "상담 결과 리포트"
    doc.report_subtitle = f"{user_name} 님 · 나의 직무 아카데미아"
    doc.kicker = "AI 커리어 적합도 리포트"

    story: list = [Spacer(1, 30 * mm + 6 * mm)]  # 배너 높이만큼 확보(첫 페이지)

    # ── 종합 적합도 히어로 ──────────────────────────────────────────────────
    # 추천 표의 '직무 적합도'와 혼동되지 않도록 라벨·캡션으로 지표 성격을 분명히 한다.
    fit = _clamp(fit_score)
    fit_caption = "상담 분석 50% + 직무 체험 수행 50% 합산" if performance is not None else "1:1 상담 분석 기준"
    hero_left = Table(
        [[Paragraph("종합 적합도", _hero_lbl)],
         [Paragraph(f'{fit}<font size="14" color="#8B86A0"> / 100</font>', _hero_num)],
         [Paragraph(fit_caption, ParagraphStyle(
             "herocap", fontName=FONT, fontSize=8.5, leading=12, textColor=MUTED))]],
        colWidths=[58 * mm],
    )
    hero_left.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    hero = Table([[hero_left, [Spacer(1, 10 * mm), _bar(fit, 92, 9)]]],
                 colWidths=[62 * mm, None], cornerRadii=[8, 8, 8, 8])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LAVENDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(hero)
    story.append(Spacer(1, 16))

    # ── 추천 직무 표 ────────────────────────────────────────────────────────
    story.append(_section("추천 직무"))
    story.append(Spacer(1, 6))
    rows = [[Paragraph("순위", _th), Paragraph("직무", _th), Paragraph("직무 적합도", _th),
             Paragraph("추천 근거 · 같은 계열 직업 예시", _th)]]
    for i, r in enumerate(recommendations, 1):
        score_cell = [Paragraph(f"{r['score']}점", _score), Spacer(1, 3), _bar(r["score"], 20)]
        reason = r.get("reason") or "-"
        related = r.get("related_jobs") or []
        reason_flow = [Paragraph(reason, _cell)]
        if related:
            reason_flow.append(Spacer(1, 3))
            reason_flow.append(Paragraph(
                f'<font name="{FONT_SB}" color="#8B86A0">같은 계열 직업 예시</font> · '
                + ", ".join(related), _cell_muted))
        rows.append([
            Paragraph(str(i), _rank),
            Paragraph(r["job_title"], _cell_sb),
            score_cell,
            reason_flow,
        ])
    table = Table(rows, colWidths=[11 * mm, 34 * mm, 24 * mm, None],
                  cornerRadii=[6, 6, 6, 6])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LAV_ALT]),
        ("LINEBELOW", (0, 1), (-1, -2), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (0, -1), 2),
        ("RIGHTPADDING", (0, 0), (0, -1), 2),
    ]))
    story.append(table)
    story.append(Spacer(1, 5))
    # 지표 혼동(점수 모순처럼 보이는 것) 방지 주석 — 신뢰도 핵심.
    story.append(Paragraph(
        "※ ‘직무 적합도’는 설문·상담에서 파악한 흥미 프로필과 각 직무가 요구하는 역량 간의 "
        "일치도입니다. 위의 ‘종합 적합도’는 상담 분석과 실제 직무 체험 수행을 합산한 별도 "
        "지표로, 산출 방식이 달라 수치가 다를 수 있습니다.", _muted))

    # 추천 묶음 AI 해석
    ins = _insight_card(recommendation_insight, "AI 해석 · 추천 직무")
    if ins is not None:
        story.append(Spacer(1, 10))
        story.append(ins)

    # ── 역량 프로필 (체험 수행 데이터가 있을 때만) ──────────────────────────
    if performance is not None:
        competencies = performance.get("competencies") or {}
        measured = {k: v for k, v in competencies.items() if v is not None}

        story.append(Spacer(1, 16))
        # 섹션 제목·안내·레이더를 한 덩어리로 유지 — 페이지 경계에서 제목만 떨어지지 않게.
        radar_unit = [
            _section("역량 프로필"), Spacer(1, 6),
            Paragraph(
                "직무 체험 중 미션 수행에서 관찰된 5개 핵심 역량입니다. "
                "바깥 링(옅은 선)이 100점, 안쪽 보라 영역이 실제 획득 수준입니다.", _body),
        ]
        radar = _radar(measured)
        if radar is not None:
            radar_unit += [Spacer(1, 4), radar]
        story.append(KeepTogether(radar_unit))

        # 강점 프로필 표 (밴드 라벨) — 직업심리검사식 수준 표기
        story.append(Spacer(1, 4))
        comp_rows = [[Paragraph("역량", _th), Paragraph("점수", _th),
                      Paragraph("수준", _th), Paragraph("", _th)]]
        for k in COMPETENCY_NAMES:
            v = competencies.get(k)
            if v is None:
                comp_rows.append([
                    Paragraph(COMPETENCY_NAMES[k], _cell),
                    Paragraph("-", _score),
                    Paragraph("미측정", _cell_muted),
                    Paragraph("", _cell),
                ])
                continue
            band_label, band_color = _band(_clamp(v))
            comp_rows.append([
                Paragraph(COMPETENCY_NAMES[k], _cell_sb),
                Paragraph(f"{_clamp(v)}점", _score),
                Paragraph(
                    f'<font color="#{band_color.hexval()[2:]}">{band_label}</font>',
                    ParagraphStyle("band", fontName=FONT_SB, fontSize=9, leading=12, alignment=TA_CENTER)),
                _bar(v, 52, 6, band_color),
            ])
        comp_table = Table(comp_rows, colWidths=[38 * mm, 18 * mm, 22 * mm, None],
                           cornerRadii=[6, 6, 6, 6])
        comp_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT),
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LAV_ALT]),
            ("LINEBELOW", (0, 1), (-1, -2), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (2, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(comp_table)

        ins = _insight_card(competency_insight, "AI 해석 · 역량")
        if ins is not None:
            story.append(Spacer(1, 10))
            story.append(ins)

        # ── 직무 체험 수행 결과 + 미션별 AI 평가 ────────────────────────────
        story.append(Spacer(1, 16))
        story.append(_section("직무 체험 수행 결과"))
        story.append(Spacer(1, 6))
        head = f"{performance['scenario_title']} — 시나리오 총점 {performance['total']}점"
        if percentile and percentile.get("top_percent") is not None:
            head += f" · 상위 {percentile['top_percent']}%"
        story.append(Paragraph(head, _cell_sb))

        # 동료 대응 태도 — 역량 점수와 별개 신호(대화 태도). 이력 없으면 생략.
        conduct = performance.get("conduct")
        if conduct:
            story.append(Spacer(1, 4))
            story.append(Paragraph(
                f"동료 대응 태도: 평균 호감도 {conduct['average']}/100"
                f" ({conduct['band']}) · 대화한 동료 {conduct['npc_count']}명", _body))

        # 미션별 AI 평가 (실제 미션 로그가 있을 때만)
        if mission_evaluations:
            titles = performance.get("mission_titles") or {}
            step_score = {m.get("step"): m.get("adjusted")
                          for m in (performance.get("missions") or [])}
            story.append(Spacer(1, 8))
            for me in mission_evaluations:
                step = me.get("step") or ""
                # step은 id('m1')·제목·둘의 혼합일 수 있어 양쪽으로 해석
                if step in titles:
                    title, sc = titles[step], step_score.get(step)
                else:
                    match = next((sid for sid, t in titles.items() if t and t == step), None)
                    title = titles.get(match, step) if match else step
                    sc = step_score.get(match)
                # 카드가 페이지 경계에서 제목/본문으로 갈라지지 않도록 한 덩어리로 유지
                story.append(KeepTogether(_mission_block(title, sc, me.get("evaluation") or "")))
                story.append(Spacer(1, 6))

    # ── 강점 / 보완점 (출처 태그) ───────────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(KeepTogether([
        _section("강점", GOOD), Spacer(1, 6),
        _tagged_callout(strengths, bar_color=GOOD, bg=GOOD_BG),
    ]))
    story.append(Spacer(1, 12))
    story.append(KeepTogether([
        _section("보완점", WARN), Spacer(1, 6),
        _tagged_callout(improvements, bar_color=WARN, bg=WARN_BG),
    ]))

    # ── 체험 소감 + AI 코칭 피드백 (소감이 있을 때만) ───────────────────────
    reflection = (performance or {}).get("reflection") if performance else None
    if reflection and (reflection or "").strip():
        story.append(Spacer(1, 16))
        quote_card = Table(
            [[Paragraph(f'“{reflection.strip()}”', _quote)]],
            colWidths=[None], cornerRadii=[6, 6, 6, 6])
        quote_card.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), LAVENDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        block = [_section("체험 소감"), Spacer(1, 6),
                 Paragraph("체험을 마치며 본인이 직접 남긴 소감입니다.", _muted),
                 Spacer(1, 5), quote_card]
        fb = _insight_card(reflection_feedback, "AI 코칭 피드백")
        if fb is not None:
            block += [Spacer(1, 8), fb]
        story.append(KeepTogether(block))

    # ── 직무 마스터의 종합 총평 ─────────────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(KeepTogether([
        _section("직무 마스터의 종합 총평"), Spacer(1, 6), _prose_card(advice)]))

    # ── 직무 기본 정보 (추천 직무 중 조사자료가 있는 첫 직무 기준) ──────────────
    # 직업정보·NCS 통계는 일부 직무(주로 사무·회계 계열)에만 존재한다. 1순위가
    # 조사 대상이 아닌 카테고리여서 비어 있어도, 추천된 직무 중 실제 값이 있는 첫
    # 직무의 공개 자료를 보여준다(하나도 없으면 통째 생략 — 없는 수치를 지어내지 않는다).
    def _ncs_fields(rec: dict):
        edu = (rec.get("education_requirement") or {}).get("value")
        stats = (rec.get("salary") or {}).get("reference_statistics") or {}
        median = stats.get("median_annual_krw")
        rec_certs = rec.get("certifications") or []
        return (edu, stats, median, rec_certs) if (edu or median or rec_certs) else None

    ncs = next(((r, f) for r in recommendations if (f := _ncs_fields(r))), None)
    if ncs is not None:
        src, (edu_value, salary_stats, median_salary, certs) = ncs
        story.append(Spacer(1, 16))
        story.append(KeepTogether([
            _section("직무 기본 정보"),
            Spacer(1, 6),
            Paragraph(
                f"추천 직무 ‘{src.get('job_title', '')}’의 공개 조사 자료(직업정보·NCS)입니다.", _muted),
            Spacer(1, 6),
            _ncs_info_card(edu_value, median_salary, salary_stats, certs),
            Spacer(1, 5),
            Paragraph(
                "※ 공개 직업정보(NCS·직업정보) 조사 자료 기준이며, 지역·경력·기업에 따라 실제와 차이가 있을 수 있습니다.",
                _muted),
        ]))

    # ── 다음 단계 CTA ───────────────────────────────────────────────────────
    if next_steps and next_steps.strip():
        story.append(Spacer(1, 16))
        story.append(KeepTogether([
            _section("다음 단계", ACCENT),
            Spacer(1, 6),
            _prose_card(next_steps, bg=HEADER_TINT, bar=ACCENT),
        ]))

    doc.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
