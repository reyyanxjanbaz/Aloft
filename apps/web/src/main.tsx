import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/boot.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateToast } from "./components/UpdateToast";
import { primeOrientation } from "./lib/orientation";
import { registerServiceWorker } from "./lib/swUpdate";

registerServiceWorker();

// Arm the tilt sensor from the very first tap anywhere — including the one that
// opens the Hangar. Waiting until the Hangar mounted meant the foil never lit.
primeOrientation();

/** Last line of defence: a render crash shows a readout, not a blank screen. */
const FAULT = (
  <div className="boot">
    <div className="boot__mark">Aloft</div>
    <p className="boot__line boot__line--warn">System fault</p>
    <p className="boot__help">
      Something in the instrument panel failed. Reload to bring the scope back up.
    </p>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary label="app" fallback={FAULT}>
      <App />
    </ErrorBoundary>
    <UpdateToast />
  </StrictMode>
);
