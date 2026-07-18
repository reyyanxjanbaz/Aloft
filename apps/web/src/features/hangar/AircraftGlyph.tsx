import { familyOf } from "@aloft/shared";

/**
 * Plan-view silhouette for collection cards. Proportions follow the family, so
 * a jumbo reads as a jumbo at thumbnail size — the old cards were four lines of
 * text with nothing to recognise.
 */
const SHAPES: Record<ReturnType<typeof familyOf>, string> = {
  // Long fuselage, four engine marks, broad swept wing.
  quad: "M32 3 L34 10 L34 22 L58 34 L58 39 L34 32 L34 46 L39 52 L39 56 L32 53 L25 56 L25 52 L30 46 L30 32 L6 39 L6 34 L30 22 L30 10 Z",
  widebody: "M32 4 L34 11 L34 23 L56 34 L56 39 L34 32 L34 45 L38 51 L38 55 L32 52 L26 55 L26 51 L30 45 L30 32 L8 39 L8 34 L30 23 L30 11 Z",
  narrowbody: "M32 5 L33.5 12 L33.5 24 L53 34 L53 38 L33.5 32 L33.5 44 L37 50 L37 54 L32 51 L27 54 L27 50 L30.5 44 L30.5 32 L11 38 L11 34 L30.5 24 L30.5 12 Z",
  // Straight, high-aspect wing.
  turboprop: "M32 6 L33.5 13 L33.5 24 L54 28 L54 32 L33.5 31 L33.5 44 L37 50 L37 54 L32 51 L27 54 L27 50 L30.5 44 L30.5 31 L10 32 L10 28 L30.5 24 L30.5 13 Z",
  ga: "M32 9 L33 15 L33 26 L50 30 L50 33 L33 32 L33 43 L36 48 L36 51 L32 49 L28 51 L28 48 L31 43 L31 32 L14 33 L14 30 L31 26 L31 15 Z",
};

export function AircraftGlyph({ typeIcao }: { typeIcao?: string }) {
  return (
    <svg className="glyph" viewBox="0 0 64 60" aria-hidden="true">
      <path d={SHAPES[familyOf(typeIcao)]} />
    </svg>
  );
}
