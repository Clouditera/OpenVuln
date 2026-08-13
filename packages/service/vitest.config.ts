import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration suites share one Postgres; avoid TRUNCATE races.
    fileParallelism: false,
  },
});
