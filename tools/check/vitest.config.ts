import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json", "json-summary"],
      thresholds: { perFile: true, statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
