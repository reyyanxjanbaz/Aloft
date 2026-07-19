import { create } from "zustand";
import type { HangarEntry } from "../features/hangar/db";

/** Destinations in the bottom nav. */
export type Tab = "radar" | "hangar" | "social" | "system";

/** Hunt and reveal are full-screen takeovers — they hide the shell chrome. */
export type View =
  | { name: Tab }
  | { name: "hunt"; hex: string }
  | {
      name: "reveal";
      entry: HangarEntry;
      isNew: boolean;
      firstSpotter?: boolean;
      /**
       * The tower recorded this catch but writing our own copy failed
       * (storage full, private mode). The reveal still shows — the catch is
       * real — with a note that it isn't in the local hangar.
       */
      localSaveFailed?: boolean;
    };

const TABS: Tab[] = ["radar", "hangar", "social", "system"];

export function isTab(view: View): view is { name: Tab } {
  return (TABS as string[]).includes(view.name);
}

interface AppState {
  view: View;
  /** The tab to return to when a takeover closes. */
  lastTab: Tab;
  go: (view: View) => void;
}

export const useApp = create<AppState>((set) => ({
  view: { name: "radar" },
  lastTab: "radar",
  go: (view) => set(isTab(view) ? { view, lastTab: view.name } : { view }),
}));
