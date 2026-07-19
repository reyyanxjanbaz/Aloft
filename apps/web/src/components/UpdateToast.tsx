import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { IconRefresh } from "../ui/icons";

/**
 * Offers a new build rather than swapping under the player's feet.
 *
 * Installed PWAs used to run a version behind indefinitely: the old worker
 * served the precached index.html at launch, and nothing ever told the page
 * a newer worker was waiting. Accepting here activates the waiting worker
 * and reloads once it takes control, so the swap is atomic.
 */
export function UpdateToast() {
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    // A capture in progress must never be interrupted by a reload, so the
    // reload is only ever triggered by the player's own tap below.
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdate(() => () => updateSW(true));
        setReady(true);
      },
    });
  }, []);

  if (!ready) return null;

  return (
    <div className="toast toast--action" role="status">
      <span>New build ready</span>
      <button
        className="toast__action"
        disabled={applying}
        onClick={() => {
          setApplying(true);
          void update?.();
        }}
      >
        <IconRefresh size={14} weight="bold" />
        {applying ? "Reloading" : "Reload"}
      </button>
    </div>
  );
}
