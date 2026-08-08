import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
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

/*
 * Reduced motion, for the half of the interface CSS cannot reach.
 *
 * base.css zeroes every CSS animation and transition under the media query,
 * but Framer Motion does not use either — it writes transforms inline, frame
 * by frame — so the screen transitions, the contact card's slide, the staggered
 * hangar grid and the reveal card's flip all played at full strength for
 * someone who had asked the OS for stillness. The tilt hook and the scope's
 * sweep each checked the setting themselves; nothing else did.
 *
 * `reducedMotion="user"` follows the system preference for every motion
 * component at once, dropping transform and layout animation while keeping
 * opacity — a fade is not what makes motion sickening, and without it elements
 * would appear and vanish with no continuity at all.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary label="app" fallback={FAULT}>
        <App />
      </ErrorBoundary>
      <UpdateToast />
    </MotionConfig>
  </StrictMode>
);
