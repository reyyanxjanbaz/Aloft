import { describe, expect, it } from "vitest";
import {
  AIRCRAFT_TYPES,
  specFor,
  NOSE_SHAPES,
  UPPER_DECKS,
  WING_MOUNTS,
  WINGLETS,
  ENGINE_TYPES,
  ENGINE_MOUNTS,
  TAIL_TYPES,
  type AircraftSpec,
} from "./airframeSpec";

/** A merged spec must have every field populated with an in-range value. */
function assertValid(spec: AircraftSpec, label: string) {
  expect(NOSE_SHAPES, `${label} noseShape`).toContain(spec.noseShape);
  expect(UPPER_DECKS, `${label} upperDeck`).toContain(spec.upperDeck);
  expect(WING_MOUNTS, `${label} wingMount`).toContain(spec.wingMount);
  expect(WINGLETS, `${label} winglet`).toContain(spec.winglet);
  expect(ENGINE_TYPES, `${label} engineType`).toContain(spec.engineType);
  expect(ENGINE_MOUNTS, `${label} engineMount`).toContain(spec.engineMount);
  expect(TAIL_TYPES, `${label} tail`).toContain(spec.tail);
  for (const k of [
    "length", "radius", "span", "rootChord", "tipChord",
    "finHeight", "finChord", "stabSpan",
  ] as const) {
    expect(spec[k], `${label} ${k}`).toBeGreaterThan(0);
  }
  expect([1, 2, 3, 4], `${label} engines`).toContain(spec.engines);
}

describe("specFor", () => {
  it("returns a complete family default for unknown / empty types", () => {
    for (const t of [undefined, "", "ZZZZ", "?!"]) {
      assertValid(specFor(t), `unknown ${String(t)}`);
    }
  });

  it("is case-insensitive", () => {
    expect(specFor("a320")).toEqual(specFor("A320"));
  });

  it("distinguishes types that share a family", () => {
    // A320 and B738 are both narrowbody but must not be identical meshes.
    const a320 = specFor("A320");
    const b738 = specFor("B738");
    expect(a320).not.toEqual(b738);
    expect(a320.winglet).toBe("sharklet");
    expect(b738.noseShape).toBe("pointed");
  });

  it("applies signature geometry cues", () => {
    expect(specFor("B748").upperDeck).toBe("hump");
    expect(specFor("A388").upperDeck).toBe("full");
    expect(specFor("CRJ9").engineMount).toBe("aft");
    expect(specFor("CRJ9").tail).toBe("ttail");
    expect(specFor("GLEX").engineMount).toBe("aft");
    expect(specFor("C172").engineMount).toBe("nose");
    expect(specFor("MD11").engines).toBe(3);
  });

  it("keeps every bespoke override a valid, complete spec", () => {
    for (const t of AIRCRAFT_TYPES) assertValid(specFor(t), t);
    // Broad coverage was the stated goal.
    expect(AIRCRAFT_TYPES.length).toBeGreaterThanOrEqual(40);
  });
});
