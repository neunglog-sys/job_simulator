"""리포트 PDF 렌더링 — reportlab + 나눔고딕 임베드 (뷰어 무관하게 한글 표시).

디자인(2026-07-26 개편): 앱 브랜드 팔레트(퍼플 #8a63ee → 핑크 #ef71bc)를 입혀
- 상단 그라디언트 배너(제목·대상자)
- 추천 직무 표: 컬러 헤더 + 교차 행 배경 + 적합도 막대(점수 시각화) + 둥근 모서리
- 종합 적합도 히어로 카드(큰 점수 + 진행 막대)
- 강점/보완점: 좌측 컬러 보더 카드(초록/앰버 톤)
- 직무 마스터의 조언: 퍼플 콜아웃 카드
- 캔버스 푸터(페이지 번호·브랜드)
볼드 TTF가 없어 위계는 '크기 + 색 + 배경'으로 구성한다(합성 볼드 미사용).
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
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

FONT = "NanumGothic"
_FONT_PATH = Path(__file__).parent / "fonts" / "NanumGothic-Regular.ttf"
pdfmetrics.registerFont(TTFont(FONT, str(_FONT_PATH)))

# ── 브랜드 팔레트 (apps/web --scenario-accent 계열) ──────────────────────────
PRIMARY = HexColor(0x6C4BEF)    # 본문·헤딩용 딥 퍼플(대비 확보)
PRIMARY_L = HexColor(0x8A63EE)  # 브랜드 퍼플(배너 그라디언트 시작)
ACCENT = HexColor(0xEF71BC)     # 브랜드 핑크(배너 그라디언트 끝·포인트)
INK = HexColor(0x2A2540)        # 본문 텍스트
MUTED = HexColor(0x8B86A0)      # 캡션·보조
LAVENDER = HexColor(0xF4F1FE)   # 카드·히어로 배경
LAV_ALT = HexColor(0xFBFAFF)    # 표 교차 행
BORDER = HexColor(0xE6E0FA)     # 헤어라인
TRACK = HexColor(0xE9E3Fb)      # 막대 트랙
GOOD = HexColor(0x179A6B)       # 강점(초록)
GOOD_BG = HexColor(0xEAF7F1)
WARN = HexColor(0xC77A12)       # 보완점(앰버)
WARN_BG = HexColor(0xFBF2E3)
HEADER_TINT = HexColor(0xF0E9FF)  # 배너 서브텍스트

_title = ParagraphStyle("title", fontName=FONT, fontSize=20, leading=26, spaceAfter=4)
_body = ParagraphStyle("body", fontName=FONT, fontSize=10, leading=16, textColor=INK)
_muted = ParagraphStyle("muted", fontName=FONT, fontSize=9, leading=13, textColor=MUTED)
_th = ParagraphStyle("th", fontName=FONT, fontSize=9.5, leading=12, textColor=white)
_cell = ParagraphStyle("cell", fontName=FONT, fontSize=9.5, leading=14, textColor=INK)
_cell_muted = ParagraphStyle("cellm", fontName=FONT, fontSize=8.5, leading=12, textColor=MUTED)
_rank = ParagraphStyle("rank", fontName=FONT, fontSize=13, leading=15, textColor=PRIMARY, alignment=TA_CENTER)
_score = ParagraphStyle("score", fontName=FONT, fontSize=12, leading=13, textColor=PRIMARY, alignment=TA_CENTER)
_hero_num = ParagraphStyle("heronum", fontName=FONT, fontSize=34, leading=36, textColor=PRIMARY)
_hero_lbl = ParagraphStyle("herolbl", fontName=FONT, fontSize=10, leading=14, textColor=MUTED)
_card = ParagraphStyle("card", fontName=FONT, fontSize=10, leading=16, textColor=INK)


COMPETENCY_NAMES = {
    "situation_judgment": "상황 판단력",
    "problem_solving": "문제해결력",
    "communication": "커뮤니케이션",
    "collaboration": "협업",
    "task_management": "업무 관리",
}


def _clamp(v: int) -> int:
    try:
        return max(0, min(100, int(v)))
    except (TypeError, ValueError):
        return 0


def _bar(score: int, width_mm: float = 20, height: float = 5) -> Table:
    """점수(0~100) 비율 막대 — 표 셀 안에 넣는 미니 진행바."""
    s = _clamp(score)
    full = width_mm * mm
    fw = full * s / 100.0
    t = Table([["", ""]], colWidths=[fw, full - fw], rowHeights=[height])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), PRIMARY),
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
            "sec", fontName=FONT, fontSize=13, leading=16, textColor=PRIMARY))]],
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


def _callout(items: list[str], *, bar_color: colors.Color, bg: colors.Color,
             dot: colors.Color) -> Table:
    """좌측 컬러 보더 + 옅은 배경의 카드. 항목마다 색 점(•)."""
    inner = []
    for i, s in enumerate(items):
        inner.append([Paragraph(
            f'<font color="#{dot.hexval()[2:]}">●</font>&nbsp; {s}', _card)])
        if i < len(items) - 1:
            inner.append([Spacer(1, 5)])
    body = Table(inner or [[Paragraph("-", _card)]], colWidths=[None])
    body.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    card = Table([[body]], colWidths=[None])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
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
        canvas.setFont(FONT, 9)
        canvas.drawString(x0 + 9 * mm, y0 + band_h - 7.5 * mm,
                          getattr(doc, "kicker", "AI 커리어 적합도 리포트"))
        canvas.setFillColor(white)
        canvas.setFont(FONT, 19)
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
) -> None:
    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
    )
    # 상담만으로 낸 것과 체험까지 반영한 것은 성격이 다르다 — 제목으로 구분한다.
    doc.report_title = "직무 체험 최종 리포트" if performance else "상담 결과 리포트"
    doc.report_subtitle = f"{user_name} 님 · 나의 직무 아카데미아"
    doc.kicker = "AI 커리어 적합도 리포트"

    story: list = [Spacer(1, 30 * mm + 6 * mm)]  # 배너 높이만큼 확보(첫 페이지)

    # ── 추천 직무 표 ────────────────────────────────────────────────────────
    story.append(_section("추천 직무"))
    story.append(Spacer(1, 6))
    rows = [[Paragraph("순위", _th), Paragraph("직무", _th), Paragraph("적합도", _th),
             Paragraph("직무 설명", _th), Paragraph("추천 근거", _th)]]
    for i, r in enumerate(recommendations, 1):
        score_cell = [Paragraph(f"{r['score']}점", _score), Spacer(1, 3), _bar(r["score"], 18)]
        rows.append([
            Paragraph(str(i), _rank),
            Paragraph(r["job_title"], _cell),
            score_cell,
            # description은 이 필드 추가 이전 스냅샷엔 없을 수 있음
            Paragraph(r.get("description") or "-", _cell_muted),
            Paragraph(r["reason"], _cell),
        ])
    table = Table(rows, colWidths=[11 * mm, 27 * mm, 22 * mm, 46 * mm, None],
                  cornerRadii=[6, 6, 6, 6])
    style = [
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
        # 순위 열은 좁아 기본 패딩이면 '순/위'로 줄바꿈된다 — 패딩만 줄여 한 줄 유지
        ("LEFTPADDING", (0, 0), (0, -1), 2),
        ("RIGHTPADDING", (0, 0), (0, -1), 2),
    ]
    table.setStyle(TableStyle(style))
    story.append(table)
    story.append(Spacer(1, 14))

    # ── 종합 적합도 히어로 ──────────────────────────────────────────────────
    fit = _clamp(fit_score)
    fit_caption = "상담 50% + 직무 체험 수행 50%" if performance is not None else "1:1 상담 분석 기준"
    hero_left = Table(
        [[Paragraph("종합 적합도", _hero_lbl)],
         [Paragraph(f'{fit}<font size="14" color="#8B86A0"> / 100</font>', _hero_num)],
         [Paragraph(fit_caption, _hero_lbl)]],
        colWidths=[52 * mm],
    )
    hero_left.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    hero = Table([[hero_left, [Spacer(1, 10 * mm), _bar(fit, 96, 9)]]],
                 colWidths=[56 * mm, None], cornerRadii=[8, 8, 8, 8])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LAVENDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(hero)

    # ── 1순위 직무 기본 정보 (조사된 직무만) ────────────────────────────────
    top = recommendations[0] if recommendations else {}
    edu_value = (top.get("education_requirement") or {}).get("value")
    salary_stats = (top.get("salary") or {}).get("reference_statistics") or {}
    median_salary = salary_stats.get("median_annual_krw")
    certs = top.get("certifications") or []
    if edu_value or median_salary or certs:
        story.append(Spacer(1, 14))
        story.append(_section("직무 기본 정보"))
        story.append(Spacer(1, 6))
        if edu_value:
            story.append(Paragraph(f"학력 요건: {edu_value}", _body))
        if median_salary:
            caption_parts = [
                p for p in (
                    f"{salary_stats['reference_year']}년" if salary_stats.get("reference_year") else None,
                    salary_stats.get("population"),
                ) if p
            ]
            caption = f" ({' · '.join(caption_parts)} 기준)" if caption_parts else ""
            story.append(Paragraph(
                f"평균 연봉: {round(median_salary / 10000):,}만원{caption}", _body))
        if certs:
            cert_names = ", ".join(c.get("name", "") for c in certs if c.get("name"))
            story.append(Paragraph(f"관련 자격증: {cert_names}", _body))

    # ── 직무 체험 수행 결과 (시뮬레이션 연결 시) ────────────────────────────
    if performance is not None:
        story.append(Spacer(1, 14))
        story.append(_section("직무 체험 수행 결과"))
        story.append(Spacer(1, 6))
        head = f"{performance['scenario_title']} — 시나리오 총점 {performance['total']}점"
        if percentile and percentile.get("top_percent") is not None:
            head += f" · 상위 {percentile['top_percent']}%"
        story.append(Paragraph(head, _body))
        story.append(Spacer(1, 6))
        comp_rows = [[Paragraph("역량", _th), Paragraph("점수", _th), Paragraph("", _th)]]
        for k, v in performance["competencies"].items():
            comp_rows.append([
                Paragraph(COMPETENCY_NAMES.get(k, k), _cell),
                Paragraph(f"{v}점" if v is not None else "-", _score),
                _bar(v if v is not None else 0, 60, 6),
            ])
        comp_table = Table(comp_rows, colWidths=[42 * mm, 20 * mm, None],
                           cornerRadii=[6, 6, 6, 6])
        comp_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT),
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LAV_ALT]),
            ("LINEBELOW", (0, 1), (-1, -2), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(comp_table)
        # 동료 대응 태도 — 역량 점수와 별개 신호(대화 태도). 이력 없으면 생략.
        conduct = performance.get("conduct")
        if conduct:
            story.append(Spacer(1, 6))
            story.append(Paragraph(
                f"동료 대응 태도: 평균 호감도 {conduct['average']}/100"
                f" ({conduct['band']}) · 대화한 동료 {conduct['npc_count']}명", _body))

    # ── 강점 / 보완점 카드 ──────────────────────────────────────────────────
    story.append(Spacer(1, 14))
    story.append(KeepTogether([
        _section("강점", GOOD), Spacer(1, 6),
        _callout(strengths, bar_color=GOOD, bg=GOOD_BG, dot=GOOD),
    ]))
    story.append(Spacer(1, 12))
    story.append(KeepTogether([
        _section("보완점", WARN), Spacer(1, 6),
        _callout(improvements, bar_color=WARN, bg=WARN_BG, dot=WARN),
    ]))

    # ── 직무 마스터의 조언 콜아웃 ───────────────────────────────────────────
    story.append(Spacer(1, 14))
    advice_card = Table([[Paragraph(advice, _card)]], colWidths=[None],
                        cornerRadii=[6, 6, 6, 6])
    advice_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LAVENDER),
        ("LINEBEFORE", (0, 0), (0, -1), 3, PRIMARY_L),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(KeepTogether([_section("직무 마스터의 조언"), Spacer(1, 6), advice_card]))

    doc.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
