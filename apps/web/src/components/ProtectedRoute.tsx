import { House, LockKey, SignIn } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { withNeun } from "../lib/korean";
import styles from "../styles/protectedRoute.module.css";
import { SpaceLoadingScreen } from "./SpaceLoadingScreen";

type ProtectedRouteProps = {
  children: ReactNode;
  destinationName: string;
  returnTo: string;
};

function ProtectedRouteLoading() {
  return (
    <SpaceLoadingScreen
      message="로그인 상태를 확인하고 있어요."
      detail="안전한 접속 경로를 확인하는 중이에요."
    />
  );
}

export function ProtectedRoute({ children, destinationName, returnTo }: ProtectedRouteProps) {
  const auth = useAuth();

  if (auth.status === "loading") {
    return <ProtectedRouteLoading />;
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
          {withNeun(destinationName)} 상담 기록과 체험 결과를 안전하게 저장하기 위해 로그인 후 이용할 수 있어요.
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
