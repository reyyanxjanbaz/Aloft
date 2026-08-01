import { useCallback, useEffect, useRef, useState } from "react";
import { RARITY_LABEL } from "../../ui/rarity";
import { IconCaretLeft, IconCaretRight } from "../../ui/icons";
import { CatchCard } from "./CatchCard";
import type { HangarEntry } from "./db";

const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(v, a), b);

/**
 * The collection as a coverflow deck: the current airframe large and centred,
 * its neighbours peeking behind at scale and rotation, drag-to-flick, and a
 * readout for the focused catch. One card fills the eye at a time, which suits
 * "show someone the plane you caught" better than a grid.
 *
 * Positions are written straight to the card holders' styles from a rAF-free
 * layout function, so dragging is smooth and doesn't re-render React each move;
 * only the focused index lives in state, for the readout, dots and arrows.
 */
export function DeckView({ entries, onOpen }: { entries: HangarEntry[]; onOpen: (e: HangarEntry) => void }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const holdersRef = useRef<(HTMLDivElement | null)[]>([]);
  const cardWidthRef = useRef(200);
  const [current, setCurrent] = useState(0);
  const n = entries.length;

  const place = useCallback(
    (pos: number) => {
      const cw = cardWidthRef.current;
      holdersRef.current.forEach((h, i) => {
        if (!h) return;
        const o = i - pos;
        const ao = Math.abs(o);
        const tx = o * cw * 0.6;
        const scale = Math.max(0.64, 1 - ao * 0.16);
        const rot = clamp(-o * 15, -32, 32);
        const op = ao > 1.85 ? 0 : Math.max(0, 1 - ao * 0.42);
        h.style.transform = `translateX(calc(-50% + ${tx}px)) scale(${scale}) rotateY(${rot}deg)`;
        h.style.opacity = op.toFixed(3);
        h.style.zIndex = String(100 - Math.round(ao * 10));
        h.style.pointerEvents = ao < 0.5 ? "auto" : "none";
      });
    },
    []
  );

  const measure = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const cw = Math.min(210, view.clientWidth * 0.62);
    cardWidthRef.current = cw;
    holdersRef.current.forEach((h) => h && (h.style.width = `${cw}px`));
  }, []);

  // Lay out on mount and whenever the collection or the focused index changes.
  useEffect(() => {
    measure();
    place(current);
  }, [measure, place, current, n]);

  useEffect(() => {
    const onResize = () => {
      measure();
      place(current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure, place, current]);

  // Keep the focused index valid if the collection shrinks (filter change).
  useEffect(() => {
    if (current > n - 1) setCurrent(Math.max(0, n - 1));
  }, [n, current]);

  const step = useCallback((dir: number) => setCurrent((c) => clamp(c + dir, 0, n - 1)), [n]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Drag-to-flick: morph the stack under the finger, then snap on release.
  const drag = useRef<{ startX: number; startPos: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startX: e.clientX, startPos: current };
    viewRef.current?.classList.add("deck__view--dragging");
    try {
      viewRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // No active pointer to capture (synthetic events) — dragging still works.
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dp = (e.clientX - drag.current.startX) / (cardWidthRef.current * 0.6);
    place(clamp(drag.current.startPos - dp, -0.45, n - 1 + 0.45));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dp = (e.clientX - drag.current.startX) / (cardWidthRef.current * 0.6);
    const target = Math.round(clamp(drag.current.startPos - dp, 0, n - 1));
    drag.current = null;
    viewRef.current?.classList.remove("deck__view--dragging");
    try {
      viewRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (target === current) place(current);
    else setCurrent(target);
  };

  const focused = entries[current];

  return (
    <div className="deck">
      <div
        ref={viewRef}
        className="deck__view"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {entries.map((e, i) => (
          <div
            key={e.id}
            className="deck__card"
            ref={(node) => {
              holdersRef.current[i] = node;
            }}
          >
            <CatchCard entry={e} onOpen={() => (i === current ? onOpen(e) : setCurrent(i))} />
          </div>
        ))}
      </div>

      {focused && (
        <div className="deck__detail" key={focused.id}>
          <h2 className="deck__detail-type">{focused.typeLabel}</h2>
          <p className="deck__detail-sub mono">
            {focused.callsign || focused.reg || focused.hex.toUpperCase()} · {RARITY_LABEL[focused.rarity]}
          </p>
          <dl className="deck__detail-row">
            <DeckStat label="Altitude" value={focused.altFt > 0 ? Math.round(focused.altFt).toLocaleString() : "Ground"} unit={focused.altFt > 0 ? "ft" : ""} />
            <DeckStat label="Range" value={focused.distanceKm.toFixed(1)} unit="km" />
            <DeckStat label="Speed" value={Math.round(focused.gsKt).toString()} unit="kt" />
          </dl>
        </div>
      )}

      <div className="deck__nav">
        <button className="icon-btn" onClick={() => step(-1)} disabled={current === 0} aria-label="Previous airframe">
          <IconCaretLeft size={20} weight="bold" />
        </button>
        <div className="deck__dots" role="tablist" aria-label="Collection position">
          {entries.map((e, i) => (
            <button
              key={e.id}
              className={i === current ? "deck__dot deck__dot--on" : "deck__dot"}
              onClick={() => setCurrent(i)}
              aria-label={`Go to ${e.typeLabel}`}
              aria-selected={i === current}
              role="tab"
            />
          ))}
        </div>
        <button className="icon-btn" onClick={() => step(1)} disabled={current === n - 1} aria-label="Next airframe">
          <IconCaretRight size={20} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function DeckStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="readout">
      <dt className="label">{label}</dt>
      <dd className="readout__value">
        {value} {unit && <span className="unit">{unit}</span>}
      </dd>
    </div>
  );
}
