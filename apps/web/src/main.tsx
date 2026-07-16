import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { completeOAuthAuthentication } from "./lib/auth";
import "./styles.css";

function consumeOAuthCallback(): void {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
  if (!token) return;

  // 토큰은 주소창에 남기지 않고, 인증 스토어가 사용자 정보까지 다시 불러오게 한다.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  void completeOAuthAuthentication(token);
}

consumeOAuthCallback();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
