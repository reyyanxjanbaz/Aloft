import { useEffect, useState } from "react";

/**
 * TEMPORARY on-device viewport probe.
 *
 * Exists to diagnose an iOS standalone-mode layout gap that cannot be
 * inspected with devtools on-device. Reports every number that feeds the
 * height chain, live, so a screenshot is enough to tell whether the layout
 * viewport itself is wrong or the CSS is mis-consuming a correct one.
 *
 * Remove this component and its mount in App.tsx once the cause is fixed.
 */

interface Probe {
  innerH: number;
  innerW: number;
  visualH: number | null;
  visualOffsetTop: number | null;
  clientH: number;
  screenH: number;
  safeTop: string;
  safeBottom: string;
  standalone: boolean;
  dpr: number;
  shellH: number | null;
  navH: number | null;
}

/** Resolves an env() value by measuring a probe element, since env() is not readable from JS. */
function measureSafeArea(side: "top" | "bottom"): string {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;height:env(safe-area-inset-${side},0px)`;
  document.body.appendChild(el);
  const px = getComputedStyle(el).height;
  el.remove();
  return px;
}

function read(): Probe {
  const shell = document.querySelector<HTMLElement>(".shell");
  const nav = document.querySelector<HTMLElement>(".nav");
  return {
    innerH: window.innerHeight,
    innerW: window.innerWidth,
    visualH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    visualOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    clientH: document.documentElement.clientHeight,
    screenH: window.screen.height,
    safeTop: measureSafeArea("top"),
    safeBottom: measureSafeArea("bottom"),
    // Both the modern and legacy iOS standalone signals.
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true,
    dpr: window.devicePixelRatio,
    shellH: shell ? Math.round(shell.getBoundingClientRect().height) : null,
    navH: nav ? Math.round(nav.getBoundingClientRect().height) : null,
  };
}

export function ViewportDebug() {
  const [p, setP] = useState<Probe>(read);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = () => setP(read());
    // Every event that can change the viewport, plus a slow poll to catch
    // iOS settling the chrome after launch without firing anything.
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    const poll = setInterval(update, 1000);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      clearInterval(poll);
    };
  }, []);

  if (hidden) return null;

  // The tell: in a correct layout shellH === innerH === clientH. Any
  // disagreement localises the bug to the viewport rather than the CSS.
  const mismatch = p.shellH !== null && Math.abs(p.shellH - p.innerH) > 1;

  return (
    <div
      onClick={() => setHidden(true)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 99999,
        margin: 8,
        padding: "8px 10px",
        maxWidth: "calc(100vw - 16px)",
        background: "rgba(0,0,0,0.88)",
        border: `1px solid ${mismatch ? "#ff4d4d" : "#39ff87"}`,
        borderRadius: 4,
        color: "#e6e6e6",
        font: "500 11px/1.5 ui-monospace, Menlo, monospace",
        letterSpacing: "0.02em",
        whiteSpace: "pre",
        pointerEvents: "auto",
      }}
    >
      {[
        `standalone   ${p.standalone}`,
        `innerHeight  ${p.innerH}`,
        `visualVP.h   ${p.visualH ?? "n/a"}`,
        `vVP.offsetY  ${p.visualOffsetTop ?? "n/a"}`,
        `docEl.client ${p.clientH}`,
        `screen.h     ${p.screenH}`,
        `safe-top     ${p.safeTop}`,
        `safe-bottom  ${p.safeBottom}`,
        `.shell h     ${p.shellH ?? "n/a"}`,
        `.nav h       ${p.navH ?? "n/a"}`,
        `dpr          ${p.dpr}`,
        mismatch ? `MISMATCH     shell-inner = ${(p.shellH ?? 0) - p.innerH}` : `match        ok`,
        `(tap to hide)`,
      ].join("\n")}
    </div>
  );
}
