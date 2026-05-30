import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 60_000,  // up from 10_000 — astro-smoke can take a while to boot
    hookTimeout: 60_000,
  },
});
