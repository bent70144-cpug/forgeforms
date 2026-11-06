// Playwright config for the FormForge e2e suite (ticket #20 e2e + future specs).
//
// Written on T20 but NOT runnable in the dev sandbox (no Playwright browsers);
// CI installs browsers via `pnpm exec playwright install --with-deps` and runs
// `pnpm exec playwright test --config apps/web/e2e/playwright.config.ts`.
//
// NOTE(merge): @playwright/test is intentionally NOT added to package.json —
// the dev sandbox cannot download browsers. CI should add it as a root
// devDependency before enabling the e2e job.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    viewport: { width: 1280, height: 800 },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @formforge/web dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
