import { useMemo } from "react";
import { KNOWN_TYPES, rarityFor, typeName } from "@aloft/shared";
import { RARITY_LABEL } from "../../ui/rarity";
import type { HangarEntry } from "./db";

/**
 * The collection as a board with holes in it.
 *
 * Every ICAO type Aloft can recognise gets a cell, lit when you have caught one
 * and outlined when you have not. A pile of cards tells you what you have; a
 * board tells you what you are missing, which is the mechanic that makes
 * collecting work.
 *
 * Deliberately not framed as completable, and there is no percentage anywhere:
 * an An-225 no longer exists and a VC-25 will not fly over most people, so a
 * large part of this board is permanently out of reach. Promising completion it
 * cannot deliver would be worse than promising nothing — so it counts what you
 * have found, and never counts down to a total.
 */
export function TypeBoard({
  entries,
  onOpen,
}: {
  entries: HangarEntry[];
  onOpen: (e: HangarEntry) => void;
}) {
  // First catch of each type — the one a tap opens.
  const caught = useMemo(() => {
    const byType = new Map<string, HangarEntry>();
    for (const e of entries) {
      const key = e.typeIcao?.toUpperCase();
      if (key && !byType.has(key)) byType.set(key, e);
    }
    return byType;
  }, [entries]);

  return (
    <>
      <div className="board__head">
        <span className="label">Type board</span>
        <span className="board__tally">
          <b className="mono">{caught.size}</b> found
        </span>
      </div>

      <ul className="board">
        {KNOWN_TYPES.map((code) => {
          const entry = caught.get(code);
          const rarity = rarityFor(code);
          const label = `${typeName(code)}, ${RARITY_LABEL[rarity]}, ${entry ? "caught" : "not caught"}`;
          return (
            <li key={code}>
              {entry ? (
                <button
                  className={`bcell bcell--on bcell--${rarity}`}
                  style={{ ["--rarity" as string]: `var(--rarity-${rarity})` }}
                  onClick={() => onOpen(entry)}
                  aria-label={label}
                >
                  <span className="bcell__code mono">{code}</span>
                </button>
              ) : (
                /* Not a button: there is nothing to open, and a grid of 60
                   dead tab stops between the caught ones is hostile. */
                <span
                  className={`bcell bcell--${rarity}`}
                  style={{ ["--rarity" as string]: `var(--rarity-${rarity})` }}
                  title={typeName(code)}
                >
                  <span className="bcell__code mono">{code}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
