import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupRoute } from "./adsbdb";

function mockFetch(impl: () => Promise<Response> | Response) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function routeResponse(origin: string, destination: string): Response {
  return new Response(
    JSON.stringify({
      response: { flightroute: { origin: { iata_code: origin }, destination: { iata_code: destination } } },
    }),
    { status: 200 }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupRoute", () => {
  it("returns a labelled route and caches it", async () => {
    const spy = mockFetch(() => routeResponse("LHR", "JFK"));

    const first = await lookupRoute("BAW117");
    const second = await lookupRoute("baw117"); // same callsign, different case

    expect(first).toEqual({ origin: "LHR", destination: "JFK" });
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("caches a genuine no-route answer so it isn't asked twice", async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ response: "unknown callsign" }), { status: 200 }));

    expect(await lookupRoute("NOROUTE1")).toBeNull();
    expect(await lookupRoute("NOROUTE1")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not cache a network failure", async () => {
    // A blip must not permanently deny route info the next lookup would get.
    const spy = mockFetch(() => Promise.reject(new Error("offline")));
    expect(await lookupRoute("FLAKY1")).toBeNull();

    vi.unstubAllGlobals();
    const retry = mockFetch(() => routeResponse("CDG", "SFO"));
    expect(await lookupRoute("FLAKY1")).toEqual({ origin: "CDG", destination: "SFO" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not cache an HTTP error", async () => {
    mockFetch(() => new Response("nope", { status: 503 }));
    expect(await lookupRoute("DOWN1")).toBeNull();

    vi.unstubAllGlobals();
    const retry = mockFetch(() => routeResponse("AMS", "SIN"));
    expect(await lookupRoute("DOWN1")).toEqual({ origin: "AMS", destination: "SIN" });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty callsign without calling the API", async () => {
    const spy = mockFetch(() => routeResponse("LHR", "JFK"));
    expect(await lookupRoute("   ")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
