import { ArrowRight, Sparkle, SuitcaseSimple } from "@phosphor-icons/react";
import { API_BASE_URL } from "../../config/endpoints";
import type { Recommendation, ScenarioSummary } from "../../lib/api";
import styles from "../../styles/oneToOneConversation.module.css";
import { ConversationModalShell } from "./ConversationModalShell";

type RecommendedJobsModalProps = {
  recommendation: Recommendation | null;
  scenarios: ScenarioSummary[];
  loading: boolean;
  error: string | null;
  needsMoreChat: boolean;
  followupQuestions: string[];
  onRetry: () => void;
  onContinueChat: () => void;
  onEnterScenario: (scenarioSlug: string) => void;
  onClose: () => void;
};

const FALLBACK_MAP = "/assets/scenario/maps/modern-design-video-studio.webp";

function backgroundFor(slug: string | null, scenarios: ScenarioSummary[]): string {
  const background = scenarios.find((scenario) => scenario.slug === slug)?.map_background;
  if (!background) return FALLBACK_MAP;
  return background.startsWith("http") ? background : `${API_BASE_URL}${background}`;
}

export function RecommendedJobsModal({
  recommendation,
  scenarios,
  loading,
  error,
  needsMoreChat,
  followupQuestions,
  onRetry,
  onContinueChat,
  onEnterScenario,
  onClose,
}: RecommendedJobsModalProps) {
  const jobs = recommendation?.results.slice(0, 3) ?? [];

  return (
    <ConversationModalShell
      title="추천 직무"
      description="설문과 상담 내용을 바탕으로 가장 잘 어울리는 진로를 추천합니다!"
      icon={SuitcaseSimple}
      size="recommendations"
      onClose={onClose}
    >
      {loading ? (
        <div className={styles.recommendedJobGrid} aria-label="추천 직무 불러오는 중">
          {Array.from({ length: 3 }, (_, index) => (
            <span className={styles.recommendedJobSkeleton} key={index} />
          ))}
        </div>
      ) : error ? (
        <div className={styles.conversationModalState} role="alert">
          <SuitcaseSimple weight="duotone" aria-hidden="true" />
          <strong>
            {needsMoreChat
              ? "상담을 조금 더 이어가주세요."
              : "아직 준비 중이에요!"}
          </strong>
          <p>{error}</p>
          {needsMoreChat ? (
            <>
              {followupQuestions.length > 0 ? (
                <ul className={styles.recommendationFollowups}>
                  {followupQuestions.slice(0, 3).map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              ) : null}
              <button type="button" onClick={onContinueChat}>상담 이어가기</button>
            </>
          ) : (
            <button type="button" onClick={onRetry}>다시 확인하기</button>
          )}
        </div>
      ) : jobs.length === 0 ? (
        <div className={styles.conversationModalState}>
          <Sparkle weight="duotone" aria-hidden="true" />
          <strong>표시할 추천 직무가 없어요.</strong>
          <p>직무 데이터를 확인한 뒤 다시 시도해주세요.</p>
          <button type="button" onClick={onRetry}>다시 확인하기</button>
        </div>
      ) : (
        <div className={styles.recommendedJobGrid}>
          {jobs.map((job, index) => (
            <article className={styles.recommendedJobCard} key={job.job_code}>
              <img
                src={backgroundFor(job.scenario_slug, scenarios)}
                alt=""
                style={{ objectPosition: `${32 + index * 18}% center` }}
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = FALLBACK_MAP;
                }}
              />
              <div className={styles.recommendedJobScrim} aria-hidden="true" />
              <div className={styles.recommendedJobRank}>추천 {index + 1}순위</div>
              <div className={styles.recommendedJobContent}>
                <div className={styles.recommendedJobHeading}>
                  <h3>{job.job_title}</h3>
                  <strong>{job.score}%</strong>
                </div>
                <p>{job.reason}</p>
                {job.scenario_slug ? (
                  <button type="button" onClick={() => onEnterScenario(job.scenario_slug!)}>
                    직무 체험하기
                    <ArrowRight aria-hidden="true" />
                  </button>
                ) : (
                  <span className={styles.recommendedJobUnavailable}>체험 시나리오 준비 중</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </ConversationModalShell>
  );
}
