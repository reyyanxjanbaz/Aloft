import { create } from "zustand";
import type { HangarEntry } from "../features/hangar/db";

export type View =
  | { name: "radar" }
  | { name: "hunt"; hex: string }
  | { name: "reveal"; entry: HangarEntry; isNew: boolean; firstSpotter?: boolean }
  | { name: "hangar" }
  | { name: "social" };

interface AppState {
  view: View;
  go: (view: View) => void;
}

export const useApp = create<AppState>((set) => ({
  view: { name: "radar" },
  go: (view) => set({ view }),
}));
