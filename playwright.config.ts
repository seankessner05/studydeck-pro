import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;

/**
 * Browser tests. `npm run test:e2e` runs the full suite. `npm run test:e2e:smoke` runs the short agent check.
 * Both start this app themselves (e2e/server.ts): made-up notes and a stand-in for Claude, never the real CLI.
 */
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
    // The phone project already runs the full study suite. The smoke file is the fast desktop check.
    { name: "phone", testIgnore: /smoke\.e2e\.ts/, use: { ...devices["Pixel 7"] } },
  ],
});
