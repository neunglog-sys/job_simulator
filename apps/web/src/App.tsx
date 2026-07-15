import { CareerLaunch } from "./components/CareerLaunch";
import { OneToOneConversationPage } from "./pages/OneToOneConversationPage";
import { ScenarioGamePage } from "./pages/ScenarioGamePage";

export default function App() {
  if (window.location.pathname.startsWith("/conversation")) {
    return <OneToOneConversationPage />;
  }

  if (window.location.pathname.startsWith("/scenario")) {
    return <ScenarioGamePage />;
  }

  return <CareerLaunch />;
}
