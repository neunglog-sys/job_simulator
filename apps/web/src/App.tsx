import { CareerLaunch } from "./components/CareerLaunch";
import { ScenarioGamePage } from "./pages/ScenarioGamePage";

export default function App() {
  if (window.location.pathname.startsWith("/scenario")) {
    return <ScenarioGamePage />;
  }

  return <CareerLaunch />;
}
