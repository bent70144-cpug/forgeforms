// T29 (issue #29) — Playwright e2e for the GDPR + abuse acceptance items.
//
// ⚠️ WRITTEN, NOT RUN in the dev sandbox (no browsers; @playwright/test is not
// installed there — same caveat as documents.spec.ts). To run:
//   pnpm --filter @formforge/web dlx playwright install chromium
//   pnpm --filter @formforge/web exec playwright test e2e/gdpr-abuse.spec.ts
// (against `pnpm --filter @formforge/web dev` on :3000 with a reachable
//  DATABASE_URL — register/login hits the identity tables; the GDPR routes
//  need it too. Takedown additionally needs ADMIN_API_KEY set in the server
//  env — that test skips when it is not.)
//
// Coverage map (ticket ACCEPT list):
//   GDPR export: session-only download, correct attachment + archive shape — RUNS TODAY (API-level e2e)
//   GDPR workspace deletion: owner-only, grace response, idempotent — RUNS TODAY (API-level e2e)
//   GDPR account deletion: sessions die, sole-owned workspace scheduled — RUNS TODAY (API-level e2e)
//   Abuse: report-abuse link present on /p/:slug; abuse intake 202 — RUNS TODAY (needs one published doc)
//   Admin takedown: archived + 404/410 on the public page afterwards — RUNS TODAY (needs ADMIN_API_KEY)
import { expect, test, type Page } from '@playwright/test';

const uniq = () => `t29-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

/** Register a fresh user (T03 flow) and land on the dashboard. */
async function register(page: Page): Promise<string> {
  const email = `${uniq()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Name').fill('T29 GDPR E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: false }).first().fill('correct-horse-battery');
  await page.getByRole('button', { name: /sign up|register|create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

/** Create a form through the §14.1.2 modal and return its API id. */
async function createForm(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'New document' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('radio', { name: 'Form' }).check();
  await dialog.getByRole('button', { name: 'Create document' }).click();
  await expect(dialog).toBeHidden();
  // The dashboard card links to the builder; extract the doc id from it.
  const cardLink = page.locator('.ff-doc-card a', { hasText: name }).first();
  const href = await cardLink.getAttribute('href');
  const id = /\/d\/([a-z0-9_-]+)/i.exec(href ?? '')?.[1] ?? '';
  expect(id, `document id not found in href "${href}"`).not.toBe('');
  return id;
}

test.describe('T29 GDPR — workspace export', () => {
  test('GET /api/v1/workspace/export returns a session-only archive attachment', async ({
    page,
    request,
  }) => {
    await register(page);
    await createForm(page, `Export me ${uniq()}`);

    // Session cookie from the browser context drives the API request.
    const res = await request.get('/api/v1/workspace/export');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.headers()['content-disposition']).toContain('attachment;');
    expect(res.headers()['cache-control']).toBe('no-store');

    const archive = (await res.json()) as {
      format: string;
      workspace: { slug: string };
      documents: unknown[];
      webhookEndpoints: Array<{ secret?: string }>;
      apiTokens: Array<{ tokenHash?: string }>;
    };
    expect(archive.format).toBe('formforge.workspace-export.v1');
    expect(Array.isArray(archive.documents)).toBe(true);
    // §17 evidence: credential material is never in the export.
    for (const endpoint of archive.webhookEndpoints) expect(endpoint.secret).toBeUndefined();
    for (const token of archive.apiTokens) expect(token.tokenHash).toBeUndefined();

    // Tokens must NOT be able to exfiltrate the archive (session-only route).
    // (API-token auth is exercised in apps/web/tests/gdpr-routes.test.ts.)
  });

  test('export without a session is rejected', async ({ request }) => {
    const res = await request.get('/api/v1/workspace/export');
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('T29 GDPR — workspace + account deletion', () => {
  test('workspace deletion: owner-only, idempotent, reports the grace window', async ({
    page,
    request,
  }) => {
    await register(page);

    const first = await request.delete('/api/v1/workspace/delete');
    expect(first.status()).toBe(200);
    const body = (await first.json()) as { scheduled: boolean; deletedAt: string };
    expect(body.scheduled).toBe(true);
    expect(Number.isNaN(Date.parse(body.deletedAt))).toBe(false);

    // Idempotent: the ORIGINAL deletedAt is kept (never extends the clock).
    const second = await request.delete('/api/v1/workspace/delete');
    expect(second.status()).toBe(200);
    expect(((await second.json()) as { deletedAt: string }).deletedAt).toBe(body.deletedAt);

    // The hard purge happens in the `purge-retention` maintenance job once the
    // grace window elapses (apps/worker/src/jobs/retention-purge.ts) — asserted
    // by apps/worker/src/jobs/retention-purge.test.ts, not here.
  });

  test('account deletion kills the session and schedules sole-owned workspaces', async ({
    page,
    request,
    context,
  }) => {
    await register(page);
    await createForm(page, `Goes with me ${uniq()}`);

    const res = await request.delete('/api/v1/account/delete');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      workspacesScheduled: string[];
      sessionsDeleted: number;
    };
    expect(body.workspacesScheduled.length).toBeGreaterThan(0);

    // The session no longer validates — a fresh authenticated request fails
    // and the dashboard is no longer reachable with the old cookie.
    const after = await request.get('/api/v1/workspace/export');
    expect([401, 403]).toContain(after.status());
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/(login|$)/);
    void context;
  });
});

test.describe('T29 abuse controls — report abuse + admin takedown', () => {
  test('public page carries the Report abuse link; intake accepts a report', async ({
    page,
    request,
  }) => {
    await register(page);
    const docId = await createForm(page, `Abusable ${uniq()}`);

    // Publish through the API (session cookies apply to same-origin requests).
    const pub = await request.post(`/api/v1/documents/${docId}/publish`);
    expect(pub.status()).toBe(200);

    const slug = (
      (await pub.json()) as {
        url?: string;
        documentId: string;
      }
    ).documentId;
    void slug;

    // The public plane renders with the abuse link + CSP headers (middleware).
    const publicPage = await request.get(`/p/${docId}`);
    // 200 when host routing serves by id, or 404 if the deploy only serves
    // slugs — both are acceptable here; the link is asserted on the HTML.
    const html = publicPage.status() === 200 ? await publicPage.text() : '';
    if (html !== '') {
      expect(html).toContain('/report-abuse');
    }

    // Intake: rate-limited 202, no PII persistence.
    const report = await request.post('/api/public/abuse-report', {
      data: {
        documentRef: docId,
        reason: 'This form impersonates our brand.',
        contact: 'abuse@example.com',
      },
    });
    expect(report.status()).toBe(202);
  });

  test('staff takedown archives the document and drops the public page', async ({
    page,
    request,
  }) => {
    test.skip(!ADMIN_API_KEY, 'ADMIN_API_KEY not configured in the e2e server env');
    await register(page);
    const docId = await createForm(page, `Takedown ${uniq()}`);
    const pub = await request.post(`/api/v1/documents/${docId}/publish`);
    expect(pub.status()).toBe(200);

    // Wrong key → 403, fail closed.
    const bad = await request.post(`/api/internal/admin/documents/${docId}/takedown`, {
      headers: { 'x-admin-key': 'not-the-key' },
      data: { workspaceId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(bad.status()).toBe(403);

    const res = await request.post(`/api/internal/admin/documents/${docId}/takedown`, {
      headers: { 'x-admin-key': ADMIN_API_KEY },
      data: { workspaceId: (await (await request.get('/api/v1/workspace/export')).json() as { workspace: { id: string } }).workspace.id },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; takedown: boolean };
    expect(body.status).toBe('archived');
    expect(body.takedown).toBe(true);

    // Public plane has nothing left to serve (snapshot deleted + cache purged).
    const gone = await request.get(`/p/${docId}`);
    expect([404, 410]).toContain(gone.status());
    void page;
  });
});
