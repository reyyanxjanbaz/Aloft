import type { ScopeDetail } from "./scopeTheme";

const KEY = "aloft-scope-detail";

/**
 * Which ground the scope is drawn on, remembered between sessions.
 *
 * A view preference the player set deliberately should not reset every time
 * they close the app, and this one changes what the screen *is* rather than
 * just how it looks — coming back to the other map would read as a bug.
 *
 * Storage is guarded: a blocked `localStorage` throws on access rather than
 * returning null, and this is read while the scope is mounting.
 */
export function readScopeDetail(): ScopeDetail {
  try {
    return localStorage.getItem(KEY) === "coast" ? "coast" : "full";
  } catch {
    return "full";
  }
}

export function writeScopeDetail(detail: ScopeDetail): void {
  try {
    localStorage.setItem(KEY, detail);
  } catch {
    /* private mode — the choice just won't survive a reload */
  }
}

/** The other ground. The declutter key toggles between exactly two. */
export function otherDetail(detail: ScopeDetail): ScopeDetail {
  return detail === "coast" ? "full" : "coast";
}
