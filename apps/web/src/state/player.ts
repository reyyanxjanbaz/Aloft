import { create } from "zustand";
import {
  cachedPlayer,
  ensurePlayerDetailed,
  forgetPlayer,
  renamePlayer,
  type CachedPlayer,
} from "../lib/player";

export type AuthState = "unknown" | "ok" | "offline" | "auth-failed";

interface PlayerState {
  player: CachedPlayer | null;
  auth: AuthState;
  refresh: () => Promise<CachedPlayer | null>;
  rename: (name: string) => Promise<void>;
  startFresh: () => Promise<void>;
}

/**
 * Identity as shared reactive state rather than a localStorage read.
 *
 * Screens used to snapshot `cachedPlayer()` at mount, so on a fresh install —
 * where registration is still in flight — the Spotters tab rendered without a
 * profile and an `?invite=` link was silently dropped, never retried.
 */
export const usePlayer = create<PlayerState>((set) => ({
  player: cachedPlayer(),
  auth: "unknown",

  refresh: async () => {
    const { player, auth } = await ensurePlayerDetailed();
    set({ player, auth });
    return player;
  },

  rename: async (name) => {
    const player = await renamePlayer(name);
    if (player) set({ player });
  },

  startFresh: async () => {
    forgetPlayer();
    set({ player: null, auth: "unknown" });
    const { player, auth } = await ensurePlayerDetailed();
    set({ player, auth });
  },
}));
