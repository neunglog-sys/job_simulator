import { Briefcase, ChartLineUp, CheckCircle } from "@phosphor-icons/react";
import { useRef } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import { GlassScrollbar } from "./GlassScrollbar";

export function FinalReportPanel() {
  const viewportRef = useRef<HTMLDivElement>(null);

  return (
    <section className={styles.finalReportPanel} aria-label="최종 직무 추천 리포트">
      <div className={styles.panelHeading}>
        <span>AI CAREER REPORT</span>
        <h2>나의 직무 탐색 리포트</h2>
        <p>대화와 설문 응답을 바탕으로 정리한 추천 결과입니다.</p>
      </div>
      <div ref={viewportRef} className={styles.reportViewport}>
        <div className={styles.reportHero}>
          <span className={styles.reportHeroIcon} aria-hidden="true">
            <Briefcase weight="duotone" />
          </span>
          <div>
            <small>가장 잘 맞는 추천 직무</small>
            <h3>서비스 기획자</h3>
            <p>사람들과 소통하며 문제를 구조화하고 해결하는 강점이 돋보여요.</p>
          </div>
        </div>
        <article className={styles.reportSection}>
          <h3><CheckCircle weight="fill" aria-hidden="true" /> 발견한 강점</h3>
          <ul>
            <li>협업 과정에서 의견을 조율하는 능력</li>
            <li>사용자의 문제를 빠르게 파악하는 관찰력</li>
            <li>새로운 상황에 유연하게 대응하는 태도</li>
          </ul>
        </article>
        <article className={styles.reportSection}>
          <h3><ChartLineUp weight="fill" aria-hidden="true" /> 추천 성장 방향</h3>
          <p>사용자 조사와 데이터 분석 경험을 쌓고, 작은 프로젝트에서 요구사항을 문서화해보세요.</p>
        </article>
        <article className={styles.reportSection}>
          <h3><Briefcase weight="fill" aria-hidden="true" /> 함께 살펴볼 직무</h3>
          <div className={styles.reportTags}>
            <span>UX 리서처</span><span>프로덕트 매니저</span><span>고객경험 기획자</span>
          </div>
        </article>
      </div>
      <GlassScrollbar
        viewportRef={viewportRef}
        className={styles.reportScrollbar}
        refreshKey="final-report"
      />
    </section>
  );
}
