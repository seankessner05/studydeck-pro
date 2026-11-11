import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;

/** Browser tests: `npm run test:e2e`. They start their own server with made-up data and a stand-in for Claude. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  // One seeded server shared by all tests, so run them one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npm run css && PORT=${PORT} npx tsx --disable-warning=ExperimentalWarning e2e/server.ts`,
    url: `http://localhost:${PORT}/api/state`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
