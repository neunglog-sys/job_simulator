/**
 * 미니게임 미리보기 — 로그인·단계 진행 없이 게임을 바로 열어 도트 아트를 검수한다.
 * dev 전용 진입점(minigame-preview.html) — 프로덕션 번들(index.html)에는 포함되지 않는다.
 * 사용: /minigame-preview.html?game=gm-01  (파라미터 없으면 선택 화면)
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MiniGamePanel } from "./components/scenario/MiniGamePanel";
import { PREVIEW_GAMES } from "./previewGames";
import "./styles.css";

const GAME_LABEL: Record<string, string> = {
  "gm-01": "입고 검수 (sort)",
  "ys-03": "정문 검색대 (match)",
  "ms-03": "회의실 세팅 (place)",
  "ys-04": "공기호흡기 점검 (gauge)",
  "jm-01": "배송 루트 (route)",
  "ms-10": "트렌치 시공 (sequence)",
  "ms-07": "전처리 리듬 (physics)",
  "ys-05": "안전 순회점검 (spot)",
  "ms-06": "정량 급이 (pour)",
  "ms-09": "정밀 시험절삭 (trace)",
  "backend-dev-day1": "알림 예외 처리 (typing)",
};

function Preview() {
  const slug = new URLSearchParams(window.location.search).get("game") ?? "";
  const game = PREVIEW_GAMES[slug];
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);

  if (!game) {
    return (
      <div style={{ minHeight: "100vh", background: "#181430", color: "#efeaff", padding: 40, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 22 }}>미니게임 미리보기 — 게임을 고르세요</h1>
        <ul style={{ lineHeight: 2.2, fontSize: 16 }}>
          {Object.keys(PREVIEW_GAMES).map((key) => (
            <li key={key}>
              <a href={`?game=${key}`} style={{ color: "#9ce0ff" }}>
                {key} — {GAME_LABEL[key] ?? ""}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="designStage" data-scenario-theme="aurora" style={{ minHeight: "100vh", background: "#181430" }}>
      <a
        href="minigame-preview.html"
        style={{ position: "absolute", top: 10, left: 12, zIndex: 120, color: "#9ce0ff", fontSize: 13 }}
      >
        ← 목록
      </a>
      <MiniGamePanel
        missionTitle="미리보기"
        game={game}
        onClear={(result) => setSent(result ?? { engine: "stub" })}
      />
      {sent ? (
        <pre
          style={{
            position: "fixed", left: 16, bottom: 16, zIndex: 130, margin: 0,
            padding: "10px 14px", borderRadius: 10, background: "#0c1f1c", color: "#7ef0cf", fontSize: 13,
          }}
        >
          결과 → {JSON.stringify(sent)}{"  "}
          <a href={`?game=${slug}`} style={{ color: "#9ce0ff" }}>다시</a>
        </pre>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
