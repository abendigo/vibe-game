import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "packages/shared/src/**/*.ts",
        "packages/server/src/**/*.ts",
        "packages/client/src/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "packages/server/src/index.ts",
        "packages/client/src/main.ts",
        "packages/client/src/renderer.ts",
        "packages/client/src/network.ts",
        "packages/client/src/input.ts",
      ],
    },
  },
});
