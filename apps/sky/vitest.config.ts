import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Postgres-backed tests share one database; parallel files would race on
    // the truncate in withCleanDb.
    fileParallelism: false,
    testTimeout: 20_000,
    setupFiles: ["src/testing/setup.ts"],
  },
});
