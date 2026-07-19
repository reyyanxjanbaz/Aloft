import { describe, expect, it } from "vitest";
import { catchIdUtc } from "./ids";

const AT_2326Z = Date.UTC(2026, 6, 19, 23, 26, 0);
const AT_2359Z = Date.UTC(2026, 6, 19, 23, 59, 0);
const AT_0001Z = Date.UTC(2026, 6, 20, 0, 1, 0);

describe("catchIdUtc", () => {
  it("is stable across a callsign change on the same flight", () => {
    // The callsign is deliberately not part of the id: it is absent on some
    // fixes and changes mid-flight on others, which used to split one flight
    // into two catches.
    expect(catchIdUtc("abc123", AT_2326Z)).toBe(catchIdUtc("abc123", AT_2359Z));
  });

  it("rolls over at the UTC day boundary", () => {
    expect(catchIdUtc("abc123", AT_2359Z)).toBe("abc123:20260719");
    expect(catchIdUtc("abc123", AT_0001Z)).toBe("abc123:20260720");
  });

  it("normalises hex case so a client and server agree", () => {
    expect(catchIdUtc("ABC123", AT_2326Z)).toBe(catchIdUtc("abc123", AT_2326Z));
  });

  it("distinguishes different airframes on the same day", () => {
    expect(catchIdUtc("abc123", AT_2326Z)).not.toBe(catchIdUtc("def456", AT_2326Z));
  });
});
