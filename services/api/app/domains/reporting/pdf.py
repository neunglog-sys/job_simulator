"""리포트 PDF 렌더링 — reportlab + 나눔고딕 임베드 (뷰어 무관하게 한글 표시)."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

FONT = "NanumGothic"
_FONT_PATH = Path(__file__).parent / "fonts" / "NanumGothic-Regular.ttf"
pdfmetrics.registerFont(TTFont(FONT, str(_FONT_PATH)))

_title = ParagraphStyle("title", fontName=FONT, fontSize=20, leading=26, spaceAfter=4)
_h2 = ParagraphStyle("h2", fontName=FONT, fontSize=13, leading=18, spaceBefore=14, spaceAfter=6)
_body = ParagraphStyle("body", fontName=FONT, fontSize=10, leading=16)
_muted = ParagraphStyle("muted", fontName=FONT, fontSize=9, leading=13, textColor=colors.grey)


def render_report_pdf(
    path: Path,
    *,
    user_name: str,
    recommendations: list[dict],
    fit_score: int,
    strengths: list[str],
    improvements: list[str],
    advice: str,
) -> None:
    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
    )
    story = [
        Paragraph("진로 적합도 리포트", _title),
        Paragraph(f"{user_name} 님 · 나의 직무 아카데미아", _muted),
        HRFlowable(width="100%", thickness=1, color=colors.black, spaceAfter=10),
        Paragraph("추천 직무", _h2),
    ]

    rows = [["순위", "직무", "적합도", "추천 근거"]]
    for i, r in enumerate(recommendations, 1):
        rows.append([str(i), r["job_title"], f"{r['score']}점", Paragraph(r["reason"], _body)])
    table = Table(rows, colWidths=[12 * mm, 32 * mm, 18 * mm, None])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(table)

    story.append(Paragraph(f"종합 적합도: {fit_score}점 / 100점", _h2))
    story.append(Paragraph("강점", _h2))
    for s in strengths:
        story.append(Paragraph(f"• {s}", _body))
        story.append(Spacer(1, 3))
    story.append(Paragraph("보완점", _h2))
    for s in improvements:
        story.append(Paragraph(f"• {s}", _body))
        story.append(Spacer(1, 3))
    story.append(Paragraph("직무 마스터의 조언", _h2))
    story.append(Paragraph(advice, _body))

    doc.build(story)
