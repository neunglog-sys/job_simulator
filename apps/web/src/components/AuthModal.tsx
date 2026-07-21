import { CaretRight, Check, X } from "@phosphor-icons/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { API_ENDPOINTS } from "../config/endpoints";
import { ApiError } from "../lib/api";
import { authenticate, rememberOAuthReturnTo } from "../lib/auth";
import {
  AUTH_LEGAL_META,
  AuthLegalDocument,
  type AuthLegalDocumentId,
} from "./AuthLegalDocument";

// 소셜 로그인 정식 브랜드 로고 (공식 "OO로 계속하기" 버튼용 마크)
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.83z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="#000000"
        d="M12 3.5C6.75 3.5 2.5 6.86 2.5 11c0 2.66 1.76 4.99 4.42 6.3-.2.72-.71 2.58-.81 2.98-.13.5.18.49.38.36.16-.11 2.5-1.7 3.51-2.39.65.09 1.32.15 2 .15 5.25 0 9.5-3.36 9.5-7.5S17.25 3.5 12 3.5z"
      />
    </svg>
  );
}

function NaverIcon() {
  return (
    <svg viewBox="0 0 23 24" width="13" height="13" aria-hidden="true">
      <path fill="#ffffff" d="M16.273 12.845 7.376 0H0v24h7.726V11.155L15.624 24H23V0h-6.727v12.845z" />
    </svg>
  );
}

export type AuthMode = "signIn" | "signUp";

type ScrollMetrics = {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
};

const INITIAL_SCROLL_METRICS: ScrollMetrics = {
  visible: false,
  thumbHeight: 100,
  thumbTop: 0,
};

function AuthScrollbar({
  viewportRef,
  refreshKey,
  variant,
}: {
  viewportRef: RefObject<HTMLElement | null>;
  refreshKey: string;
  variant: "main" | "legal";
}) {
  const [metrics, setMetrics] = useState(INITIAL_SCROLL_METRICS);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateMetrics = () => {
      const maximumScroll = viewport.scrollHeight - viewport.clientHeight;
      if (maximumScroll <= 1) {
        setMetrics(INITIAL_SCROLL_METRICS);
        return;
      }

      const thumbHeight = Math.max(12, (viewport.clientHeight / viewport.scrollHeight) * 100);
      const thumbTop = (viewport.scrollTop / maximumScroll) * (100 - thumbHeight);
      setMetrics({ visible: true, thumbHeight, thumbTop });
    };

    updateMetrics();
    const animationFrame = window.requestAnimationFrame(updateMetrics);
    viewport.addEventListener("scroll", updateMetrics, { passive: true });

    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(viewport);
    if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      viewport.removeEventListener("scroll", updateMetrics);
      resizeObserver.disconnect();
    };
  }, [refreshKey, viewportRef]);

  return (
    <div
      className={`auth-custom-scrollbar auth-custom-scrollbar--${variant} ${
        metrics.visible ? "is-visible" : ""
      }`}
      aria-hidden="true"
    >
      <span
        style={{
          height: `${metrics.thumbHeight}%`,
          top: `${metrics.thumbTop}%`,
        }}
      />
    </div>
  );
}

function LegalDocumentPanel({
  documentId,
  onClose,
  onAgree,
}: {
  documentId: AuthLegalDocumentId;
  onClose: () => void;
  onAgree: (documentId: AuthLegalDocumentId) => void;
}) {
  const [canAgree, setCanAgree] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const meta = AUTH_LEGAL_META[documentId];

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    setCanAgree(viewport.scrollHeight <= viewport.clientHeight + 2);
    headingRef.current?.focus();
  }, [documentId]);

  const updateAgreementGate = () => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const reachedEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 4;
    if (reachedEnd) setCanAgree(true);
  };

  return (
    <section
      className="auth-legal-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-legal-title"
    >
      <header className="auth-legal-header">
        <div>
          <p>{meta.eyebrow}</p>
          <h2 id="auth-legal-title" ref={headingRef} tabIndex={-1}>
            {meta.title}
          </h2>
          <span>끝까지 확인한 뒤 동의할 수 있어요.</span>
        </div>
        <button className="auth-legal-close" type="button" onClick={onClose} aria-label="약관 닫기">
          <X weight="bold" />
        </button>
      </header>

      <div className="auth-legal-scroll-region" ref={scrollRef} onScroll={updateAgreementGate}>
        <AuthLegalDocument documentId={documentId} />
      </div>
      <AuthScrollbar viewportRef={scrollRef} refreshKey={documentId} variant="legal" />

      <footer className="auth-legal-footer">
        <p aria-live="polite">
          {canAgree ? "문서를 모두 확인했어요." : "문서를 끝까지 내려 확인해주세요."}
        </p>
        <button
          className="button button-primary auth-legal-agree"
          type="button"
          disabled={!canAgree}
          onClick={() => onAgree(documentId)}
        >
          동의하고 돌아가기
        </button>
      </footer>
    </section>
  );
}

type Props = {
  mode: AuthMode;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  onSuccess: () => void;
};

export function AuthModal({ mode, onClose, onModeChange, onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isMainScrolled, setIsMainScrolled] = useState(false);
  const [activeLegalDocument, setActiveLegalDocument] = useState<AuthLegalDocumentId | null>(null);
  const [consents, setConsents] = useState<Record<AuthLegalDocumentId, boolean>>({
    terms: false,
    privacy: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isSignUp = mode === "signUp";
  const hasRequiredConsents = consents.terms && consents.privacy;
  const consentRequired = isSignUp && !hasRequiredConsents;

  // 모드 전환/최초 진입 시 첫 입력칸에 포커스, 이전 에러 초기화.
  useEffect(() => {
    setError("");
    setIsMainScrolled(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    formRef.current?.querySelector("input")?.focus();
  }, [mode]);

  // ESC로 닫기.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeLegalDocument) setActiveLegalDocument(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeLegalDocument, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");

    if (isSignUp && password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요.");
      return;
    }

    if (consentRequired) {
      setError("회원가입을 계속하려면 필수 약관을 모두 확인하고 동의해주세요.");
      return;
    }

    setBusy(true);
    try {
      await authenticate(mode, {
        email,
        password,
        name,
        termsAgreed: consents.terms,
        privacyAgreed: consents.privacy,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  const acceptLegalDocument = (documentId: AuthLegalDocumentId) => {
    setConsents((current) => ({ ...current, [documentId]: true }));
    setActiveLegalDocument(null);
    setError("");
  };

  const guardSocialAuthentication = (event: MouseEvent<HTMLAnchorElement>) => {
    if (consentRequired) {
      event.preventDefault();
      setError("소셜 계정으로 가입하려면 필수 약관을 먼저 확인해주세요.");
      return;
    }

    rememberOAuthReturnTo();
  };

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isSignUp ? "회원가입" : "로그인"}
    >
      <div className="auth-backdrop" onClick={onClose} />
      <div className="auth-card" data-main-scrolled={isMainScrolled && !activeLegalDocument}>
        <button className="auth-close" type="button" onClick={onClose} aria-label="닫기">
          <X weight="bold" />
        </button>

        <div
          className="auth-scroll-region"
          ref={scrollRef}
          onScroll={(event) => setIsMainScrolled(event.currentTarget.scrollTop > 4)}
        >
          <div className="auth-scroll-content">
            <p className="auth-eyebrow">직무 아카데미아</p>
            <h2 className="auth-title">{isSignUp ? "새 계정 만들기" : "다시 오셨네요"}</h2>
            <p className="auth-subtitle">
              {isSignUp
                ? "AI 아바타와 함께 나의 직무 여정을 시작해요."
                : "이어서 나의 직무 여정을 계속해요."}
            </p>

            <form className="auth-form" ref={formRef} onSubmit={submit} noValidate>
            {isSignUp && (
              <label className="auth-field">
                <span>이름</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="홍길동"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </label>
            )}

            <label className="auth-field">
              <span>이메일</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="auth-field">
              <span>비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isSignUp ? "8자 이상" : "비밀번호"}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                minLength={isSignUp ? 8 : undefined}
                maxLength={72}
              />
            </label>

              {isSignUp && (
                <fieldset className="auth-consents">
                  <legend>필수 약관 동의</legend>
                  {(["terms", "privacy"] as AuthLegalDocumentId[]).map((documentId) => {
                    const meta = AUTH_LEGAL_META[documentId];
                    const agreed = consents[documentId];
                    return (
                      <button
                        className="auth-consent-row"
                        type="button"
                        key={documentId}
                        onClick={() => setActiveLegalDocument(documentId)}
                      >
                        <span className="auth-consent-check" data-checked={agreed} aria-hidden="true">
                          <Check weight="bold" />
                        </span>
                        <span className="auth-consent-copy">
                          <strong>
                            <b>[필수]</b> {meta.consentLabel} 동의
                          </strong>
                          <small>{agreed ? "확인 및 동의 완료" : "내용을 읽고 동의해주세요"}</small>
                        </span>
                        <span className="auth-consent-open">
                          내용 보기 <CaretRight weight="bold" />
                        </span>
                      </button>
                    );
                  })}
                </fieldset>
              )}

              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={busy || consentRequired}
              >
                {busy ? "처리 중…" : isSignUp ? "가입하고 시작하기" : "로그인"}
              </button>
            </form>

            <div className="auth-social-divider" aria-hidden="true">
              <span>또는</span>
            </div>
            <div className="auth-social-actions" aria-label="소셜 로그인">
              <a
                className="auth-social-button auth-social-google"
                href={API_ENDPOINTS.auth.oauth.google}
                aria-disabled={consentRequired}
                onClick={guardSocialAuthentication}
              >
                <span className="auth-social-mark" aria-hidden="true">
                  <GoogleIcon />
                </span>
                Google로 계속하기
              </a>
              <a
                className="auth-social-button auth-social-kakao"
                href={API_ENDPOINTS.auth.oauth.kakao}
                aria-disabled={consentRequired}
                onClick={guardSocialAuthentication}
              >
                <span className="auth-social-mark" aria-hidden="true">
                  <KakaoIcon />
                </span>
                카카오로 계속하기
              </a>
              <a
                className="auth-social-button auth-social-naver"
                href={API_ENDPOINTS.auth.oauth.naver}
                aria-disabled={consentRequired}
                onClick={guardSocialAuthentication}
              >
                <span className="auth-social-mark" aria-hidden="true">
                  <NaverIcon />
                </span>
                네이버로 계속하기
              </a>
            </div>

            <p className="auth-switch">
              {isSignUp ? "이미 계정이 있으세요? " : "아직 계정이 없으세요? "}
              <button type="button" onClick={() => onModeChange(isSignUp ? "signIn" : "signUp")}>
                {isSignUp ? "로그인" : "회원가입"}
              </button>
            </p>
          </div>
        </div>
        <AuthScrollbar
          viewportRef={scrollRef}
          refreshKey={`${mode}:${String(error)}:${String(hasRequiredConsents)}`}
          variant="main"
        />

        {activeLegalDocument && (
          <LegalDocumentPanel
            documentId={activeLegalDocument}
            onClose={() => setActiveLegalDocument(null)}
            onAgree={acceptLegalDocument}
          />
        )}
      </div>
    </div>
  );
}
