import { familyOf, type Family } from "@aloft/shared";

/**
 * Dimensions that drive the generated airframe. Values are in scene units and
 * are loosely proportional to the real families, so a 747 reads as a 747 next
 * to an A320 rather than everything being the same tube with different colours.
 */
export interface AirframeSpec {
  length: number;
  radius: number;
  /** Full wingspan. */
  span: number;
  /** Leading-edge sweep, as a fraction of half-span shifted aft. */
  sweep: number;
  rootChord: number;
  tipChord: number;
  dihedral: number;
  engines: number;
  propeller: boolean;
  highWing: boolean;
  winglets: boolean;
  windows: boolean;
  finHeight: number;
  finChord: number;
  stabSpan: number;
  /** Extra deck line for the 747's hump. */
  upperDeck: boolean;
}

const SPECS: Record<Family, AirframeSpec> = {
  quad: {
    length: 7.4, radius: 0.44, span: 7.0, sweep: 1.5, rootChord: 1.5, tipChord: 0.42,
    dihedral: 0.1, engines: 4, propeller: false, highWing: false, winglets: false,
    windows: true, finHeight: 1.35, finChord: 1.25, stabSpan: 2.5, upperDeck: true,
  },
  widebody: {
    length: 6.8, radius: 0.4, span: 6.4, sweep: 1.35, rootChord: 1.35, tipChord: 0.36,
    dihedral: 0.12, engines: 2, propeller: false, highWing: false, winglets: true,
    windows: true, finHeight: 1.2, finChord: 1.1, stabSpan: 2.3, upperDeck: false,
  },
  narrowbody: {
    length: 5.4, radius: 0.3, span: 5.0, sweep: 1.0, rootChord: 1.05, tipChord: 0.3,
    dihedral: 0.1, engines: 2, propeller: false, highWing: false, winglets: true,
    windows: true, finHeight: 1.0, finChord: 0.9, stabSpan: 1.8, upperDeck: false,
  },
  turboprop: {
    length: 4.2, radius: 0.28, span: 4.6, sweep: 0.18, rootChord: 0.8, tipChord: 0.42,
    dihedral: 0.04, engines: 2, propeller: true, highWing: true, winglets: false,
    windows: true, finHeight: 1.0, finChord: 0.8, stabSpan: 1.6, upperDeck: false,
  },
  ga: {
    length: 2.7, radius: 0.22, span: 3.4, sweep: 0.05, rootChord: 0.62, tipChord: 0.46,
    dihedral: 0.06, engines: 1, propeller: true, highWing: true, winglets: false,
    windows: false, finHeight: 0.68, finChord: 0.55, stabSpan: 1.15, upperDeck: false,
  },
};

export function specFor(typeIcao: string | undefined): AirframeSpec {
  return SPECS[familyOf(typeIcao)];
}
