import { useState } from "react";
import { shareFile } from "../../lib/platform";
import { usePlayer } from "../../state/player";
import { IconShare } from "../../ui/icons";
import type { HangarEntry } from "../hangar/db";
import type { SnapshotRef } from "../reveal/Stage";
import { renderCatchCard } from "./catchCard";

type Phase = "idle" | "rendering" | "shared" | "saved" | "failed";

const COPY: Record<Phase, string> = {
  idle: "Share card",
  rendering: "Rendering",
  shared: "Shared",
  saved: "Saved",
  failed: "Couldn't render",
};

/**
 * Turns a catch into an image the player can post.
 *
 * Prefers a snapshot of the actual 3D model on screen — the aircraft they
 * are looking at, in the paint it was rendered in — and falls back to the
 * family silhouette when the stage can't provide one.
 */
export function ShareCardButton({
  entry,
  firstSpotter,
  snapshotRef,
  className = "btn",
}: {
  entry: HangarEntry;
  firstSpotter: boolean;
  snapshotRef?: SnapshotRef;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const spotterCode = usePlayer((s) => s.player?.code);

  const run = async () => {
    setPhase("rendering");
    try {
      const blob = await renderCatchCard({
        entry,
        firstSpotter,
        spotterCode,
        snapshotDataUrl: snapshotRef?.current?.() ?? null,
      });
      const name = `aloft-${(entry.reg || entry.hex).toLowerCase().replace(/[^a-z0-9]/g, "")}.png`;
      const result = await shareFile(
        new File([blob], name, { type: "image/png" }),
        "Aloft",
        `${entry.typeLabel} caught on Aloft`
      );
      setPhase(result === "shared" ? "shared" : result === "downloaded" ? "saved" : "failed");
    } catch {
      setPhase("failed");
    }
    // Return to the resting label so the control is obviously reusable.
    setTimeout(() => setPhase("idle"), 2400);
  };

  return (
    <button className={className} disabled={phase === "rendering"} onClick={() => void run()}>
      <IconShare size={16} weight="bold" />
      {COPY[phase]}
    </button>
  );
}
