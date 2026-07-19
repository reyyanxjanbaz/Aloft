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
import { ViewportDebug } from "./ui/ViewportDebug";

/**
 * TEMPORARY: set to false (or delete both this flag and the ViewportDebug
 * import/mount) once the iOS standalone layout gap is resolved. Mounted here
 * rather than inside App because App returns early for the boot, hunt and
 * reveal screens, and the probe has to be visible on all of them.
 */
const SHOW_VIEWPORT_DEBUG = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {SHOW_VIEWPORT_DEBUG && <ViewportDebug />}
  </StrictMode>
);
