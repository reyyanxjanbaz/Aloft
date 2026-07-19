import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several units under test touch window/screen/matchMedia even though the
    // logic itself is pure, so a DOM is cheaper than mocking each global.
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
