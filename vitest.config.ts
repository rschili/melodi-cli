import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks", // needed for native addons (IModelHost) - threads won't work
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/buildInfo.ts", "src/index.ts", "src/types.d.ts"],
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
