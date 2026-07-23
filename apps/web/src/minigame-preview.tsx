/**
 * 미니게임 미리보기 — 로그인·단계 진행 없이 게임을 바로 열어 도트 아트를 검수한다.
 * dev 전용 진입점(minigame-preview.html) — 프로덕션 번들(index.html)에는 포함되지 않는다.
 * 사용: /minigame-preview.html?game=gm-01  (파라미터 없으면 선택 화면)
 */
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MiniGamePanel } from "./components/scenario/MiniGamePanel";
import { PREVIEW_GAMES } from "./previewGames";
import scenarioStyles from "./styles/scenarioGame.module.css";
import "./styles.css";

// 라벨은 게임 정의에서 파생 — 목록이 늘어도 하드코딩 불필요.
const labelOf = (key: string): string => {
  const game = PREVIEW_GAMES[key];
  return game ? `${game.title} (${game.engine})` : "";
};

function Preview() {
  const slug = new URLSearchParams(window.location.search).get("game") ?? "";
  const flowGames = useMemo(
    () =>
      slug === "kts-03-flow"
        ? [
            { ...PREVIEW_GAMES["kts-03-supply"], id: "kts-03-supply" },
            { ...PREVIEW_GAMES["kts-03"], id: "kts-03-customer" },
          ]
        : undefined,
    [slug],
  );
  const game = flowGames?.[0] ?? PREVIEW_GAMES[slug];
  const gameWithId = useMemo(() => (game ? { ...game, id: slug } : null), [game, slug]);
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);

  if (!game) {
    return (
      <div style={{ minHeight: "100vh", background: "#181430", color: "#efeaff", padding: 40, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 22 }}>미니게임 미리보기 — 게임을 고르세요</h1>
        <ul style={{ lineHeight: 2.2, fontSize: 16 }}>
          {Object.keys(PREVIEW_GAMES)
            .sort((a, b) => {
              const ea = PREVIEW_GAMES[a].engine;
              const eb = PREVIEW_GAMES[b].engine;
              return ea === eb ? a.localeCompare(b) : ea.localeCompare(eb);
            })
            .map((key) => (
              <li key={key}>
                <a href={`?game=${key}`} style={{ color: "#9ce0ff" }}>
                  {key} — {labelOf(key)}
                </a>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className={scenarioStyles.designStage}
      data-scenario-theme="aurora"
      style={{
        position: "relative",
        inset: "auto",
        width: "100%",
        height: "100vh",
        minHeight: "100vh",
        overflow: "hidden",
        background: "#181430",
        transform: "none",
      }}
    >
      <a
        href="minigame-preview.html"
        style={{ position: "absolute", top: 10, left: 12, zIndex: 120, color: "#9ce0ff", fontSize: 13 }}
      >
        ← 목록
      </a>
      <MiniGamePanel
        missionTitle="미리보기"
        game={gameWithId}
        games={flowGames}
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

const previewRoot = createRoot(document.getElementById("root")!);

previewRoot.render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => previewRoot.unmount());
}
