import { RARITY_LABEL } from "../../ui/rarity";
import { AircraftGlyph } from "./AircraftGlyph";
import type { HangarEntry } from "./db";
import "./catchcard.css";

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };

/**
 * A caught airframe as a collectible "foil" card. Keeps the Flight Deck idiom —
 * near-black, hairlines, corner ticks, tight radius — but earns a phosphor
 * scanline sheen and a 3D tilt driven by the shared collection light source
 * (useCollectionTilt on the Hangar container). The rarity colour is the only
 * hue, and the sheen strengthens with rarity, so a legendary genuinely shines
 * more than a common.
 */
export function CatchCard({ entry, onOpen }: { entry: HangarEntry; onOpen: () => void }) {
  const ident = entry.callsign || entry.reg || entry.hex.toUpperCase();
  const date = new Date(entry.caughtAt).toLocaleDateString(undefined, SHORT_DATE);

  return (
    <button
      className={`cc cc--${entry.rarity}`}
      style={{ ["--rarity" as string]: `var(--rarity-${entry.rarity})` }}
      onClick={onOpen}
      aria-label={`${entry.typeLabel}, ${ident}, ${RARITY_LABEL[entry.rarity]}, caught ${date}`}
    >
      <span className="cc__glow" aria-hidden="true" />
      <span className="cc__card">
        <span className="cc__layer cc__grid" aria-hidden="true" />
        <span className="cc__layer cc__subject" aria-hidden="true">
          <AircraftGlyph typeIcao={entry.typeIcao} />
        </span>
        {/* The foil sits above the artwork — that is the whole effect. */}
        <span className="cc__layer cc__sheen" aria-hidden="true" />
        <span className="cc__chip">
          <i aria-hidden="true" />
          {RARITY_LABEL[entry.rarity]}
        </span>
        <span className="cc__layer cc__ticks" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="cc__foot">
          <span className="cc__type">{entry.typeLabel}</span>
          <span className="cc__ident mono">{ident}</span>
          <span className="cc__meta">
            <span className="cc__rarity">{RARITY_LABEL[entry.rarity]}</span>
            <span className="cc__date mono">{date}</span>
          </span>
        </span>
      </span>
    </button>
  );
}
