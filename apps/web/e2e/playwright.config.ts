// Playwright config for the FormForge e2e suite (T07 documents + T20 logic
// builder specs and future specs).
//
// Written on T07/T20 but NOT runnable in the dev sandbox (no Playwright
// browsers); CI installs browsers via `pnpm exec playwright install
// --with-deps` and runs `pnpm exec playwright test --config
// apps/web/e2e/playwright.config.ts`.
//
// NOTE(merge): @playwright/test ships as a devDependency (T07) so the specs
// typecheck; browser download stays CI-gated.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? "http://localhost:3000",
    trace: "on-first-retry",
    viewport: { width: 1280, height: 800 },
  },
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: "pnpm --filter @formforge/web dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
