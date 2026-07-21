import { CareerLaunch } from "./components/CareerLaunch";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { OneToOneConversationPage } from "./pages/OneToOneConversationPage";
import { MyPage } from "./pages/MyPage";
import { ScenarioGamePage } from "./pages/ScenarioGamePage";

export default function App() {
  if (window.location.pathname.startsWith("/mypage")) {
    return (
      <ProtectedRoute destinationName="내 정보" returnTo="/mypage">
        <MyPage />
      </ProtectedRoute>
    );
  }

  if (window.location.pathname.startsWith("/conversation")) {
    return (
      <ProtectedRoute destinationName="1:1 직무 상담" returnTo="/conversation">
        <OneToOneConversationPage />
      </ProtectedRoute>
    );
  }

  if (window.location.pathname.startsWith("/scenario")) {
    return (
      <ProtectedRoute
        destinationName="가상 회사 직무 체험"
        returnTo={`${window.location.pathname}${window.location.search}`}
      >
        <ScenarioGamePage />
      </ProtectedRoute>
    );
  }

  return <CareerLaunch />;
}
