import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The API tests start a server and run whole flows; on a busy machine some take over the 5 s default.
    testTimeout: 15_000,
    // Browser tests run with Playwright (npm run test:e2e), not here.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
