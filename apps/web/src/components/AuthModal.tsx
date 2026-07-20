import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { API_ENDPOINTS } from "../config/endpoints";
import { ApiError } from "../lib/api";
import { authenticate } from "../lib/auth";

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
  const formRef = useRef<HTMLFormElement>(null);

  const isSignUp = mode === "signUp";

  // 모드 전환/최초 진입 시 첫 입력칸에 포커스, 이전 에러 초기화.
  useEffect(() => {
    setError("");
    formRef.current?.querySelector("input")?.focus();
  }, [mode]);

  // ESC로 닫기.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");

    if (isSignUp && password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요.");
      return;
    }

    setBusy(true);
    try {
      await authenticate(mode, { email, password, name });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isSignUp ? "회원가입" : "로그인"}
    >
      <div className="auth-backdrop" onClick={onClose} />
      <div className="auth-card">
        <button className="auth-close" type="button" onClick={onClose} aria-label="닫기">
          <X weight="bold" />
        </button>

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

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button className="button button-primary auth-submit" type="submit" disabled={busy}>
            {busy ? "처리 중…" : isSignUp ? "가입하고 시작하기" : "로그인"}
          </button>
        </form>

        <div className="auth-social-divider" aria-hidden="true">
          <span>또는</span>
        </div>
        <div className="auth-social-actions" aria-label="소셜 로그인">
          <a className="auth-social-button auth-social-google" href={API_ENDPOINTS.auth.oauth.google}>
            <span className="auth-social-mark" aria-hidden="true">
              <GoogleIcon />
            </span>
            Google로 계속하기
          </a>
          <a className="auth-social-button auth-social-kakao" href={API_ENDPOINTS.auth.oauth.kakao}>
            <span className="auth-social-mark" aria-hidden="true">
              <KakaoIcon />
            </span>
            카카오로 계속하기
          </a>
          <a className="auth-social-button auth-social-naver" href={API_ENDPOINTS.auth.oauth.naver}>
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
  );
}
