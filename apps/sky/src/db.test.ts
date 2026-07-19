import { expect, it } from "vitest";
import { sql } from "./db";
import { describeIfDb } from "./testing/db";

describeIfDb("db", () => {
  it("answers a trivial query", async () => {
    const [row] = await sql<{ n: number }[]>`select 1 as n`;
    expect(row?.n).toBe(1);
  });
});
