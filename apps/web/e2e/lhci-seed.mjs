// T28 (issue #28) — Lighthouse CI seeder (CI-only; requires a running web app
// at $FF_URL — default http://localhost:3000 — with a reachable database, and
// Playwright's chromium installed).
//
// What it does:
//   1. Registers a fresh user through the real /register UI (server actions).
//   2. Creates a portfolio from the designer-portfolio template via the v1 API
//      and publishes it (published URL = /p/<slug>, the scroll plane).
//   3. Reads the checked-in lighthouserc.{desktop,mobile}.json budgets, appends
//      the published /p/:slug URL, and writes the runtime configs that the
//      Lighthouse CI workflow runs.
//
// Usage (CI): pnpm --filter @formforge/web exec node e2e/lhci-seed.mjs
// (lives under apps/web so @playwright/test resolves; ROOT points at the repo)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.FF_URL ?? 'http://localhost:3000';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const uniq = () => `t28lhci-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Register through the UI (session cookie lands in context.request).
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Name').fill('T28 LHCI seed');
  const email = `${uniq()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: false }).first().fill('correct-horse-battery');
  await page.getByRole('button', { name: /sign up|register|create account/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  console.log(`[lhci-seed] registered ${email}`);

  // 2. Create + publish a portfolio from the designer template.
  const created = await context.request.post(`${BASE}/api/v1/documents`, {
    data: { type: 'portfolio', title: 'T28 published portfolio', templateId: 'designer-portfolio' },
  });
  if (!created.ok()) {
    throw new Error(`[lhci-seed] create failed ${created.status()}: ${await created.text()}`);
  }
  const doc = await created.json();
  const published = await context.request.post(`${BASE}/api/v1/documents/${doc.id}/publish`);
  if (!published.ok()) {
    throw new Error(`[lhci-seed] publish failed ${published.status()}: ${await published.text()}`);
  }
  const detail = (await context.request.get(`${BASE}/api/v1/documents/${doc.id}`)).json();
  const { slug } = await detail;
  const publishedUrl = `${BASE}/p/${slug}`;
  console.log(`[lhci-seed] published portfolio → ${publishedUrl}`);

  // 3. Generate runtime LHCI configs (canonical budgets + dynamic URL).
  for (const variant of ['desktop', 'mobile']) {
    const source = JSON.parse(readFileSync(`${ROOT}/lighthouserc.${variant}.json`, 'utf8'));
    source.ci.collect.url = [...source.ci.collect.url, publishedUrl];
    const out = `${ROOT}/lighthouserc.${variant}.runtime.json`;
    writeFileSync(out, JSON.stringify(source, null, 2));
    console.log(`[lhci-seed] wrote ${out} with urls: ${source.ci.collect.url.join(', ')}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error('[lhci-seed] FAILED:', error);
  process.exit(1);
});
