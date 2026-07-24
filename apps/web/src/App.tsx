import { CareerLaunch } from "./components/CareerLaunch";
import { PostOAuthPolicyProfileModal } from "./components/PostOAuthPolicyProfileModal";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { OneToOneConversationPage } from "./pages/OneToOneConversationPage";
import { MyPage } from "./pages/MyPage";
import { ScenarioGamePage } from "./pages/ScenarioGamePage";

export default function App() {
  let page;

  if (window.location.pathname.startsWith("/mypage")) {
    page = (
      <ProtectedRoute destinationName="내 정보" returnTo="/mypage">
        <MyPage />
      </ProtectedRoute>
    );
  } else if (window.location.pathname.startsWith("/conversation")) {
    page = (
      <ProtectedRoute destinationName="1:1 직무 상담" returnTo="/conversation">
        <OneToOneConversationPage />
      </ProtectedRoute>
    );
  } else if (window.location.pathname.startsWith("/scenario")) {
    page = (
      <ProtectedRoute
        destinationName="가상 회사 직무 체험"
        returnTo={`${window.location.pathname}${window.location.search}`}
      >
        <ScenarioGamePage />
      </ProtectedRoute>
    );
  } else {
    page = <CareerLaunch />;
  }

  return (
    <>
      {page}
      <PostOAuthPolicyProfileModal />
    </>
  );
}
