import { useEffect, useState } from "react";
import { listCatches } from "../features/hangar/db";

const DISMISS_KEY = "aloft-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Shown on the radar only after the first catch (peak motivation) and never
 * inside an installed app. iOS gets the Add-to-Home-Screen walkthrough —
 * required there for push and full-screen; Android gets the native prompt.
 */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;
    void listCatches().then((catches) => {
      if (catches.length > 0) setVisible(true);
    });
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  return (
    <div className="install">
      {isIOS() ? (
        <p>
          <strong>Keep your hangar with you</strong> — tap <span className="install__icon">⎋</span> Share, then
          “Add to Home Screen”. Installed, Aloft can ping you when something rare flies over.
        </p>
      ) : installEvent ? (
        <p>
          <strong>Install Aloft</strong> for full-screen hunts and rare-plane alerts.{" "}
          <button
            className="install__btn"
            onClick={() => {
              void installEvent.prompt();
              dismiss();
            }}
          >
            Install
          </button>
        </p>
      ) : (
        <p>
          <strong>Tip:</strong> install Aloft from your browser menu for full-screen hunts and alerts.
        </p>
      )}
      <button className="install__close" onClick={dismiss}>✕</button>
    </div>
  );
}
