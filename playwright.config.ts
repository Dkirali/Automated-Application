import { defineConfig, devices } from "@playwright/test";
import path from "path";

const PORT = Number(process.env.E2E_PORT || 3001);
const TEST_DB = path.resolve(__dirname, "tests/e2e/.test.db");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // shared DB + in-memory apply tracker — keep sequential
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      JOBBOT_DB: TEST_DB,
      JOBBOT_TEST_MODE: "1",
      // Sandbox writable paths so the setup/settings POSTs can never touch
      // the developer's real .env or resumes directory.
      JOBBOT_ENV_PATH: path.resolve(__dirname, "tests/e2e/.test.env"),
      JOBBOT_RESUMES_DIR: path.resolve(__dirname, "tests/e2e/.test-resumes"),
      // Provide a fake key so callLlm's env check passes if anything calls it
      // (specs that exercise LLM code paths seed values directly to skip calls).
      GROQ_API_KEY: process.env.GROQ_API_KEY || "test-key-do-not-use",
    },
  },
});
