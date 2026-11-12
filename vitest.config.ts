import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/main.ts",
        "src/worker.ts",
        "src/agent/durable.ts",
        "src/tui/render.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/vitest",
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/unit/**/*.spec.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          environment: "node",
          include: ["test/e2e/**/*.spec.ts"],
          globalSetup: ["./test/e2e/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
