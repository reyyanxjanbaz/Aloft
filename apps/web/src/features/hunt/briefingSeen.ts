const KEY = "aloft-briefed";

/**
 * Whether this device has been through the capture briefing.
 *
 * The full briefing is a wall you hit before every single hunt, and on the
 * fortieth catch it is pure friction. It shows once; after that the arm screen
 * collapses to the aim solution and a one-line privacy note.
 *
 * Deliberately still a screen rather than nothing: it carries the user gesture
 * that `primeAudio()` and the camera permission prompt both depend on. Removing
 * it entirely would silently cost the app all sound.
 *
 * Storage failures resolve to "not seen" — showing the long version again is a
 * mild annoyance; skipping it on a device that has never seen it is worse.
 */
export function hasSeenBriefing(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markBriefingSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode — the briefing will simply show again next time */
  }
}
