import { CheckCircle, ShieldCheck, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, updatePolicyProfile } from "../lib/api";
import {
  clearPostOAuthPolicyProfileCompletion,
  hasPostOAuthPolicyProfileCompletion,
  useAuth,
} from "../lib/auth";
import {
  buildPolicyProfileUpdate,
  EMPTY_POLICY_PROFILE_FORM,
  type PolicyProfileForm,
} from "../lib/policyProfile";
import { AuthScrollbar } from "./AuthModal";
import { PolicyProfileFields } from "./PolicyProfileFields";

export function PostOAuthPolicyProfileModal() {
  const auth = useAuth();
  const [isOpen, setIsOpen] = useState(hasPostOAuthPolicyProfileCompletion);
  const [profile, setProfile] = useState<PolicyProfileForm>(() => ({
    ...EMPTY_POLICY_PROFILE_FORM,
  }));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLDivElement>(null);

  const closeForNow = useCallback(() => {
    clearPostOAuthPolicyProfileCompletion();
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen || auth.status !== "authed") return;

    const firstInput = firstFieldRef.current?.querySelector<HTMLInputElement>("input, select");
    firstInput?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) closeForNow();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [auth.status, closeForNow, isOpen, isSaving]);

  if (!isOpen || auth.status !== "authed") return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const result = buildPolicyProfileUpdate(profile);
    if (result.error) {
      setError(result.error);
      return;
    }

    if (Object.keys(result.profile).length === 0) {
      setError("저장할 맞춤 정보가 없어요. 입력하거나 나중에 입력하기를 선택해주세요.");
      return;
    }

    setIsSaving(true);
    try {
      await updatePolicyProfile(result.profile);
      clearPostOAuthPolicyProfileCompletion();
      setIsSaved(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "맞춤 정보를 저장하지 못했어요. 입력값은 그대로 두었으니 다시 시도해주세요.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="auth-overlay policy-completion-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isSaved ? "맞춤 정보 저장 완료" : "맞춤 제도 프로필 입력"}
    >
      <div className="auth-backdrop" onClick={isSaving ? undefined : closeForNow} />
      <div
        className="auth-card policy-completion-card"
        data-auth-mode="signUp"
        data-main-scrolled="false"
      >
        {!isSaved && (
          <button
            className="auth-close"
            type="button"
            onClick={closeForNow}
            disabled={isSaving}
            aria-label="나중에 입력하기"
          >
            <X weight="bold" />
          </button>
        )}

        <div className="auth-scroll-region" ref={scrollRef}>
          <div className="auth-scroll-content">
            {isSaved ? (
              <div className="policy-completion-success">
                <CheckCircle weight="fill" aria-hidden="true" />
                <p className="auth-eyebrow">PROFILE SAVED</p>
                <h2 className="auth-title">맞춤 정보가 저장됐어요</h2>
                <p className="auth-subtitle">
                  입력한 조건을 바탕으로 더 알맞은 취업 지원제도를 찾아드릴게요.
                </p>
                <button
                  className="button button-primary auth-submit"
                  type="button"
                  onClick={closeForNow}
                >
                  계속하기
                </button>
              </div>
            ) : (
              <>
                <div className="policy-completion-heading">
                  <span className="policy-completion-icon" aria-hidden="true">
                    <ShieldCheck weight="duotone" />
                  </span>
                  <div>
                    <p className="auth-eyebrow">소셜 가입 완료</p>
                    <h2 className="auth-title">맞춤 추천을 완성해볼까요?</h2>
                  </div>
                </div>
                <p className="auth-subtitle">
                  로그인은 완료됐어요. 입력한 조건은 취업 지원제도 추천에만 사용해요.
                </p>

                <form className="auth-form" onSubmit={submit} noValidate>
                  <div ref={firstFieldRef}>
                    <PolicyProfileFields value={profile} onChange={setProfile} />
                  </div>

                  {error && (
                    <p className="auth-error" role="alert">
                      {error}
                    </p>
                  )}

                  <div className="policy-completion-actions">
                    <button
                      className="button button-primary auth-submit"
                      type="submit"
                      disabled={isSaving}
                    >
                      {isSaving ? "저장 중..." : "맞춤 정보 저장"}
                    </button>
                    <button
                      className="policy-completion-skip"
                      type="button"
                      onClick={closeForNow}
                      disabled={isSaving}
                    >
                      나중에 입력하기
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
        <AuthScrollbar
          viewportRef={scrollRef}
          refreshKey={`${error}:${isSaving}:${isSaved}`}
          variant="main"
        />
      </div>
    </div>
  );
}
