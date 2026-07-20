import { House, LockKey, SignIn } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import styles from "../styles/protectedRoute.module.css";

type ProtectedRouteProps = {
  children: ReactNode;
  destinationName: string;
  returnTo: string;
};

export function ProtectedRoute({ children, destinationName, returnTo }: ProtectedRouteProps) {
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <main className={styles.screen} aria-label="로그인 상태 확인 중">
        <div className={styles.loadingCard} role="status">
          <span />
          <span />
          <span />
          <p>로그인 상태를 확인하고 있어요.</p>
        </div>
      </main>
    );
  }

  if (auth.status === "authed") return children;

  const loginUrl = `/?auth=login&returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <main className={styles.screen} aria-label="로그인이 필요한 화면">
      <section className={styles.card}>
        <span className={styles.icon} aria-hidden="true">
          <LockKey weight="duotone" />
        </span>
        <p className={styles.eyebrow}>MEMBER ACCESS</p>
        <h1>로그인이 필요한 화면이에요.</h1>
        <p className={styles.description}>
          {destinationName}은 상담 기록과 체험 결과를 안전하게 저장하기 위해 로그인 후 이용할 수 있어요.
        </p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href={loginUrl}>
            <SignIn aria-hidden="true" />
            로그인하기
          </a>
          <a className={styles.secondaryAction} href="/">
            <House aria-hidden="true" />
            메인으로 이동
          </a>
        </div>
      </section>
    </main>
  );
}
