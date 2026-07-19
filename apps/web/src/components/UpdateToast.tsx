import { reloadForUpdate, useUpdate } from "../lib/swUpdate";
import { IconRefresh } from "../ui/icons";

/**
 * Only appears when a new build arrived mid-capture, where reloading
 * automatically would discard a lock the player is holding. Everywhere else
 * the update applies itself.
 */
export function UpdateToast() {
  const ready = useUpdate((s) => s.ready);
  if (!ready) return null;

  return (
    <div className="toast toast--action" role="status">
      <span>New build ready</span>
      <button className="toast__action" onClick={reloadForUpdate}>
        <IconRefresh size={14} weight="bold" />
        Reload
      </button>
    </div>
  );
}
