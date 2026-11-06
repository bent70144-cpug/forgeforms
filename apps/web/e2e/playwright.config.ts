// T07 — Playwright config for the documents e2e suite.
// ⚠️ WRITTEN, NOT RUN in the T07 sandbox (no browsers, no @playwright/test
// dependency — wired at integration, see e2e/documents.spec.ts header).
// Run with:
//   pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'documents.spec.ts',
  timeout: 30_000,
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @formforge/web dev',
    url: 'http://localhost:3000/dashboard',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
