// Playwright config for the T05 auth-recovery E2E suite.
// WRITTEN BUT NOT RUN in the sandbox (no browsers, no live Postgres/Redis):
// CI runs `pnpm --filter @formforge/web exec playwright test` with the
// docker-compose stack up. The web server gets DEV_MAIL_OUTBOX so the suite
// can read the dev transport's outbox file (see e2e/auth-recovery.spec.ts).
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_WEB_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev --port 3100",
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Dev transport with a local outbox — required by the reset-link tests.
      DEV_MAIL_OUTBOX: process.env.DEV_MAIL_OUTBOX ?? ".e2e-mail",
      // Point at the compose Postgres when the suite runs in CI.
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
    },
  },
});
