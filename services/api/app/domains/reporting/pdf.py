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


COMPETENCY_NAMES = {
    "situation_judgment": "상황 판단력",
    "problem_solving": "문제해결력",
    "communication": "커뮤니케이션",
    "collaboration": "협업",
    "task_management": "업무 관리",
}


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
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
    )
    story = [
        Paragraph(
            # 상담만으로 낸 것과 체험까지 반영한 것은 성격이 다르다 — 제목으로 구분한다
            "직무 체험 최종 리포트" if performance else "상담 결과 리포트", _title
        ),
        Paragraph(f"{user_name} 님 · 나의 직무 아카데미아", _muted),
        HRFlowable(width="100%", thickness=1, color=colors.black, spaceAfter=10),
        Paragraph("추천 직무", _h2),
    ]

    rows = [["순위", "직무", "적합도", "직무 설명", "추천 근거"]]
    for i, r in enumerate(recommendations, 1):
        # description은 이 필드 추가 이전에 저장된 과거 추천 스냅샷엔 없을 수 있음
        rows.append([
            str(i),
            r["job_title"],
            f"{r['score']}점",
            Paragraph(r.get("description") or "-", _muted),
            Paragraph(r["reason"], _body),
        ])
    table = Table(rows, colWidths=[12 * mm, 26 * mm, 16 * mm, 48 * mm, None])
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

    fit_label = f"종합 적합도: {fit_score}점 / 100점"
    if performance is not None:
        fit_label += "  (상담 50% + 직무 체험 수행 50%)"
    story.append(Paragraph(fit_label, _h2))

    # 1순위 직무만 표시 — 학력/급여/자격증은 조사된 직무가 일부라 대부분 비어있다.
    top = recommendations[0] if recommendations else {}
    edu_value = (top.get("education_requirement") or {}).get("value")
    salary_stats = (top.get("salary") or {}).get("reference_statistics") or {}
    median_salary = salary_stats.get("median_annual_krw")
    certs = top.get("certifications") or []
    if edu_value or median_salary or certs:
        story.append(Paragraph("직무 기본 정보", _h2))
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
            story.append(Paragraph(f"평균 연봉: {round(median_salary / 10000):,}만원{caption}", _body))
        if certs:
            cert_names = ", ".join(c.get("name", "") for c in certs if c.get("name"))
            story.append(Paragraph(f"관련 자격증: {cert_names}", _body))
        story.append(Spacer(1, 4))

    if performance is not None:
        story.append(Paragraph("직무 체험 수행 결과", _h2))
        head = f"{performance['scenario_title']} — 시나리오 총점 {performance['total']}점"
        if percentile and percentile.get("top_percent") is not None:
            head += f" · 상위 {percentile['top_percent']}%"
        story.append(Paragraph(head, _body))
        story.append(Spacer(1, 4))
        comp_rows = [["역량", "점수"]] + [
            [COMPETENCY_NAMES.get(k, k), f"{v}점" if v is not None else "-"]
            for k, v in performance["competencies"].items()
        ]
        comp_table = Table(comp_rows, colWidths=[50 * mm, 25 * mm])
        comp_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(comp_table)
        # 동료 대응 태도 — 역량 점수와 별개 신호(대화 태도). 대화 이력이 없으면 생략.
        conduct = performance.get("conduct")
        if conduct:
            story.append(Spacer(1, 4))
            story.append(
                Paragraph(
                    f"동료 대응 태도: 평균 호감도 {conduct['average']}/100"
                    f" ({conduct['band']}) · 대화한 동료 {conduct['npc_count']}명",
                    _body,
                )
            )

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
