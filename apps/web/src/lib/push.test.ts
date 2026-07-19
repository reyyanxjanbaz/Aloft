import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push";

/** Encodes bytes the way a VAPID public key arrives: base64url, unpadded. */
function toBase64Url(bytes: Uint8Array): string {
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("urlBase64ToUint8Array", () => {
  it("round-trips bytes that need every padding length", () => {
    // A padding mistake here is silent: the subscription succeeds and only
    // the eventual push is rejected.
    for (const length of [1, 2, 3, 4, 65]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256);
      expect(urlBase64ToUint8Array(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("decodes the url-safe alphabet, not standard base64", () => {
    // 0xfb 0xff encodes as "+/8" in standard base64 and "-_8" in base64url;
    // decoding the latter with atob alone would throw or corrupt.
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    expect(urlBase64ToUint8Array(toBase64Url(bytes))).toEqual(bytes);
  });

  it("produces a 65-byte key from a realistic VAPID string", () => {
    const key = toBase64Url(Uint8Array.from({ length: 65 }, (_, i) => i));
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});
