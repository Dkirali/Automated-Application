import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "JOBBOT_DB=tests/e2e/test.db npx next dev --port 3001",
    port: 3001,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
