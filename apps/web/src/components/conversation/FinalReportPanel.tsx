import {
  Briefcase,
  ChartLineUp,
  CheckCircle,
  DownloadSimple,
  GraduationCap,
  ListChecks,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { ApiError, fetchReportPdfBlob } from "../../lib/api";
import styles from "../../styles/oneToOneConversation.module.css";
import type { ReportState } from "../../types/conversation";
import { GlassScrollbar } from "./GlassScrollbar";

type FinalReportPanelProps = {
  reportState: ReportState;
  onRetry: () => void;
};

const retryButtonStyle = {
  marginTop: 14,
  padding: "10px 18px",
  border: "1px solid rgba(121,81,187,0.35)",
  borderRadius: 12,
  background: "rgba(121,81,187,0.12)",
  color: "#3b2f53",
  fontWeight: 700,
  cursor: "pointer",
} as const;

export function FinalReportPanel({ reportState, onRetry }: FinalReportPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { phase, recommendation, report, message, followupQuestions } = reportState;
  const [pdfStatus, setPdfStatus] = useState<"idle" | "loading" | "error">("idle");

  const topJob = recommendation?.results[0] ?? null;
  const otherJobs = recommendation?.results.slice(1, 4) ?? [];

  // 조사 안 된 직무가 대부분이라 세 필드 다 없는 경우가 흔함 — 하나라도 있을 때만 섹션을 그린다.
  const educationValue = topJob?.education_requirement?.value ?? null;
  const salaryStats = topJob?.salary?.reference_statistics;
  const medianSalary = salaryStats?.median_annual_krw ?? null;
  const certifications = topJob?.certifications ?? [];
  const hasJobMeta = Boolean(educationValue) || medianSalary !== null || certifications.length > 0;

  const handleDownloadPdf = async () => {
    if (!report || pdfStatus === "loading") return;
    setPdfStatus("loading");
    try {
      const blob = await fetchReportPdfBlob(report.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `진로리포트_${report.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPdfStatus("idle");
    } catch (error) {
      setPdfStatus("error");
      // eslint-disable-next-line no-console
      console.error("PDF 다운로드 실패", error instanceof ApiError ? error.message : error);
    }
  };

  return (
    <section className={styles.finalReportPanel} aria-label="최종 직무 추천 리포트">
      <div className={styles.panelHeading}>
        <span>AI CAREER REPORT</span>
        <h2>나의 직무 탐색 리포트</h2>
        <p>대화와 설문 응답을 바탕으로 정리한 추천 결과입니다.</p>
      </div>
      <div ref={viewportRef} className={styles.reportViewport}>
        {phase === "idle" || phase === "loading" ? (
          <div className={styles.reportHero}>
            <span className={styles.reportHeroIcon} aria-hidden="true">
              <Briefcase weight="duotone" />
            </span>
            <div>
              <small>분석 중</small>
              <h3>대화를 바탕으로 리포트를 만들고 있어요</h3>
              <p>상담 내용을 분석해서 적합한 직무를 찾고 있어요. 잠시만 기다려주세요.</p>
            </div>
          </div>
        ) : null}

        {phase === "needs-more-chat" ? (
          <article className={styles.reportSection}>
            <h3>
              <CheckCircle weight="fill" aria-hidden="true" /> 조금 더 이야기해볼까요?
            </h3>
            <p>{message}</p>
            {followupQuestions.length > 0 ? (
              <ul>
                {followupQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}

        {phase === "error" ? (
          <article className={styles.reportSection}>
            <h3>
              {/* 실패 상태에 성공 아이콘(CheckCircle)이 붙어 있었다 — 문구는 실패인데
                  체크 표시라 리포트가 만들어진 것처럼 읽혔다. */}
              <WarningCircle weight="fill" aria-hidden="true" /> 리포트를 만들지 못했어요
            </h3>
            <p>{message}</p>
            <button type="button" onClick={onRetry} style={retryButtonStyle}>
              다시 시도
            </button>
          </article>
        ) : null}

        {phase === "ready" && topJob ? (
          <>
            <div className={styles.reportHero}>
              <span className={styles.reportHeroIcon} aria-hidden="true">
                <Briefcase weight="duotone" />
              </span>
              <div>
                <small>
                  {report?.kind_label ?? "상담 결과 리포트"} · 가장 잘 맞는 추천 직무 · 적합도{" "}
                  {topJob.score}%
                </small>
                <h3>{topJob.job_title}</h3>
                {topJob.description ? (
                  <p className={styles.reportJobDescription}>{topJob.description}</p>
                ) : null}
                <p>{topJob.reason}</p>
              </div>
            </div>
            {hasJobMeta ? (
              <article className={styles.reportSection}>
                <h3>
                  <GraduationCap weight="fill" aria-hidden="true" /> 직무 기본 정보
                </h3>
                <dl className={styles.reportJobMeta}>
                  {educationValue ? (
                    <div className={styles.reportJobMetaRow}>
                      <dt>학력 요건</dt>
                      <dd>{educationValue}</dd>
                    </div>
                  ) : null}
                  {medianSalary !== null ? (
                    <div className={styles.reportJobMetaRow}>
                      <dt>평균 연봉</dt>
                      <dd>
                        {Math.round(medianSalary / 10000).toLocaleString()}만원
                        {salaryStats?.reference_year || salaryStats?.population ? (
                          <span className={styles.reportJobMetaCaption}>
                            {" "}
                            ({salaryStats.reference_year ? `${salaryStats.reference_year}년 · ` : ""}
                            {salaryStats.population ?? ""} 기준)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                  {certifications.length > 0 ? (
                    <div className={styles.reportJobMetaRow}>
                      <dt>관련 자격증</dt>
                      <dd>
                        <div className={styles.reportTags}>
                          {certifications.map((cert) => (
                            <span key={cert.name}>{cert.name}</span>
                          ))}
                        </div>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ) : null}
            <article className={styles.reportSection}>
              <h3>
                <CheckCircle weight="fill" aria-hidden="true" /> 발견한 강점
              </h3>
              <ul>
                {(report?.strengths ?? []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            {(report?.improvements?.length ?? 0) > 0 ? (
              <article className={styles.reportSection}>
                <h3>
                  <ListChecks weight="fill" aria-hidden="true" /> 보완하면 좋은 점
                </h3>
                <ul>
                  {(report?.improvements ?? []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ) : null}
            <article className={styles.reportSection}>
              <h3>
                <ChartLineUp weight="fill" aria-hidden="true" /> 추천 성장 방향
              </h3>
              <p>{report?.advice}</p>
            </article>
            {report ? (
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfStatus === "loading"}
                style={retryButtonStyle}
              >
                <DownloadSimple weight="bold" aria-hidden="true" />{" "}
                {pdfStatus === "loading"
                  ? "PDF 준비 중..."
                  : pdfStatus === "error"
                    ? "다운로드 실패 · 다시 시도"
                    : "PDF로 저장"}
              </button>
            ) : null}
            {otherJobs.length > 0 ? (
              <article className={styles.reportSection}>
                <h3>
                  <Briefcase weight="fill" aria-hidden="true" /> 함께 살펴볼 직무
                </h3>
                <div className={styles.reportTags}>
                  {otherJobs.map((job) => (
                    <span key={job.job_code}>{job.job_title}</span>
                  ))}
                </div>
              </article>
            ) : null}
          </>
        ) : null}
      </div>
      <GlassScrollbar
        viewportRef={viewportRef}
        className={styles.reportScrollbar}
        refreshKey={phase}
      />
    </section>
  );
}
