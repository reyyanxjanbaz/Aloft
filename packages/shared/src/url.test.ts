import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./url";

describe("normalizeBaseUrl", () => {
  it("strips a trailing slash", () => {
    expect(normalizeBaseUrl("https://sky.example.com/")).toBe("https://sky.example.com");
  });

  it("strips repeated trailing slashes", () => {
    expect(normalizeBaseUrl("https://sky.example.com///")).toBe("https://sky.example.com");
  });

  it("leaves an already-clean URL untouched", () => {
    expect(normalizeBaseUrl("https://sky.example.com")).toBe("https://sky.example.com");
  });

  it("preserves a port", () => {
    expect(normalizeBaseUrl("http://localhost:8787/")).toBe("http://localhost:8787");
  });

  it("produces a single-slash path when a rooted path is appended", () => {
    // The actual bug: "…/" + "/ws" -> "…//ws", which Fastify 404s.
    expect(`${normalizeBaseUrl("https://sky.example.com/")}/ws`).toBe("https://sky.example.com/ws");
  });

  it("derives a wss:// URL correctly, as the client does", () => {
    const base = normalizeBaseUrl("https://sky.example.com/");
    expect(`${base.replace(/^http/, "ws")}/ws`).toBe("wss://sky.example.com/ws");
  });
});
