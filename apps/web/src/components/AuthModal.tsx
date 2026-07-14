import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import { authenticate } from "../lib/auth";

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
