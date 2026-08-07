import { beforeEach, describe, expect, it } from "vitest";
import { CAPTURE_RADIUS_KM, destinationPoint, type AircraftState } from "@aloft/shared";
import {
  BLOCK_MIN_ZOOM,
  MAX_BLOCKS,
  MAX_TRAILS,
  MAX_VECTORS,
  selectBlocks,
  selectPredicted,
  selectTrailed,
} from "./dataBlocks";
import { clearTracks } from "./trackHistory";

const ME = { lat: 51.47, lon: -0.45 };
const NOW = 1_700_000_000_000;

/** An aircraft `km` away on `bearing`, stationary unless told otherwise. */
function at(hex: string, km: number, bearing = 0, over: Partial<AircraftState> = {}): AircraftState {
  const [lat, lon] = destinationPoint(ME.lat, ME.lon, bearing, km * 1000);
  return {
    hex,
    callsign: "",
    lat,
    lon,
    altFt: 30_000,
    gsKt: 0,
    track: null,
    seenPosSec: 0,
    ts: NOW,
    ...over,
  };
}

beforeEach(() => clearTracks());

describe("selectBlocks", () => {
  it("draws nothing below the zoom floor", () => {
    // Text over a scope this coarse is unreadable and overlaps immediately.
    expect(selectBlocks([at("a", 5)], ME, null, BLOCK_MIN_ZOOM - 0.1, NOW)).toEqual([]);
  });

  it("caps how many blocks are drawn", () => {
    const many = Array.from({ length: MAX_BLOCKS + 8 }, (_, i) => at(`h${i}`, 5 + i));
    expect(selectBlocks(many, ME, null, 10, NOW)).toHaveLength(MAX_BLOCKS);
  });

  it("spends the cap on selected, then capturable, then nearest", () => {
    const far = at("far", CAPTURE_RADIUS_KM + 200);
    const near = at("near", 2, 90);
    const mid = at("mid", 10, 180);
    const picked = selectBlocks([far, mid, near], ME, "far", 10, NOW);
    expect(picked.map((b) => b.hex)).toEqual(["far", "near", "mid"]);
  });

  it("labels with the callsign, falling back to registration then hex", () => {
    const [withCs, withReg, bare] = selectBlocks(
      [
        at("aaa111", 1, 0, { callsign: "BAW117" }),
        at("bbb222", 2, 0, { reg: "G-XWBA" }),
        at("ccc333", 3),
      ],
      ME,
      null,
      10,
      NOW
    );
    expect(withCs!.ident).toBe("BAW117");
    expect(withReg!.ident).toBe("G-XWBA");
    expect(bare!.ident).toBe("CCC333");
  });

  it("writes altitude as a padded flight level, and GND on the ground", () => {
    const [high, low, ground] = selectBlocks(
      [at("a", 1, 0, { altFt: 37_000 }), at("b", 2, 0, { altFt: 900 }), at("c", 3, 0, { altFt: 0 })],
      ME,
      null,
      10,
      NOW
    );
    expect(high!.level).toBe("370");
    expect(low!.level).toBe("009");
    expect(ground!.level).toBe("GND");
  });

  it("marks capturable contacts as in range", () => {
    const [inside, outside] = selectBlocks(
      [at("in", CAPTURE_RADIUS_KM - 1), at("out", CAPTURE_RADIUS_KM + 40)],
      ME,
      null,
      10,
      NOW
    );
    expect(inside!.inRange).toBe(true);
    expect(outside!.inRange).toBe(false);
  });
});

describe("selectPredicted", () => {
  it("skips contacts already inside the ring", () => {
    // The ring and the mark's own colour already say these are capturable.
    const inside = at("in", 5, 0, { track: 180, gsKt: 400 });
    expect(selectPredicted([inside], ME, null, NOW)).toEqual([]);
  });

  it("skips contacts flying away", () => {
    const away = at("away", CAPTURE_RADIUS_KM + 20, 0, { track: 0, gsKt: 400 });
    expect(selectPredicted([away], ME, null, NOW)).toEqual([]);
  });

  it("keeps a contact that will enter the ring", () => {
    // North of us, tracking due south — it flies straight overhead.
    const inbound = at("inbound", CAPTURE_RADIUS_KM + 20, 0, { track: 180, gsKt: 400 });
    expect(selectPredicted([inbound], ME, null, NOW).map((a) => a.hex)).toEqual(["inbound"]);
  });

  it("always keeps the selected contact, even flying away", () => {
    const away = at("away", CAPTURE_RADIUS_KM + 20, 0, { track: 0, gsKt: 400 });
    expect(selectPredicted([away], ME, "away", NOW).map((a) => a.hex)).toEqual(["away"]);
  });

  it("skips contacts with no track rather than assuming north", () => {
    const trackless = at("t", CAPTURE_RADIUS_KM + 20, 0, { track: null, gsKt: 400 });
    expect(selectPredicted([trackless], ME, null, NOW)).toEqual([]);
  });

  it("skips a selected contact that has nothing to predict from", () => {
    // deadReckon returns the aircraft's own position without a track or a
    // speed, so a vector here would be a zero-length line and an open
    // "predicted position" circle sitting on top of the mark — a prediction
    // claimed but never made. The selected contact is not exempt from that.
    const noTrack = at("a", CAPTURE_RADIUS_KM + 20, 0, { track: null, gsKt: 400 });
    const parked = at("b", CAPTURE_RADIUS_KM + 20, 0, { track: 180, gsKt: 0 });
    expect(selectPredicted([noTrack], ME, "a", NOW)).toEqual([]);
    expect(selectPredicted([parked], ME, "b", NOW)).toEqual([]);
  });

  it("caps how many vectors are drawn however busy the cell is", () => {
    const swarm = Array.from({ length: MAX_VECTORS + 25 }, (_, i) =>
      at(`h${i}`, CAPTURE_RADIUS_KM + 5 + i * 0.1, 0, { track: 180, gsKt: 400 })
    );
    expect(selectPredicted(swarm, ME, null, NOW)).toHaveLength(MAX_VECTORS);
  });
});

describe("selectTrailed", () => {
  it("caps trails so a busy feed cannot drive per-frame cost", () => {
    // A wide viewport over Europe streams the better part of a thousand
    // contacts; trails for all of them rebuilt every frame was thousands of
    // throwaway features a second, on marks a few pixels across.
    const many = Array.from({ length: MAX_TRAILS + 200 }, (_, i) => at(`h${i}`, 1 + i));
    expect(selectTrailed(many, ME, null, NOW)).toHaveLength(MAX_TRAILS);
  });

  it("keeps the nearest, and always the selected one", () => {
    const near = at("near", 2);
    const mid = at("mid", 40);
    const distant = at("distant", 900);
    const picked = selectTrailed([distant, mid, near], ME, "distant", NOW);
    expect(picked.map((a) => a.hex)).toEqual(["distant", "near", "mid"]);
  });

  it("returns everything when the feed is small", () => {
    expect(selectTrailed([at("a", 3), at("b", 9)], ME, null, NOW)).toHaveLength(2);
  });
});
