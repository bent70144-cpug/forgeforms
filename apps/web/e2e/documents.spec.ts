// T07 — Playwright e2e for the M2 acceptance items (issue #7).
//
// ⚠️ WRITTEN, NOT RUN: this sandbox has no browsers and @playwright/test is not
// installed (see the ticket report). To run:
//   pnpm --filter @formforge/web dlx playwright install chromium
//   pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts
// (against `pnpm --filter @formforge/web dev` on :3000 with a reachable
//  DATABASE_URL — register/login hits the identity tables.)
//
// Coverage map (ticket ACCEPT list):
//   AC1 create form → edit hero → reload preserves state   — test.fixme (needs T08 builder page)
//   AC2 two tabs, stale baseRev 409 + recovery             — test.fixme (needs T08 builder page)
//   AC3 invalid ops → §4 error shape with field details    — RUNS TODAY (API-level e2e through the running server)
//   AC4 dashboard badges + create modal per-type body      — RUNS TODAY
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const uniq = () => `t07-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let docId = '';

/** Register a fresh user (T03 flow) and land on the dashboard. */
async function register(page: Page): Promise<string> {
  const email = `${uniq()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Name').fill('T07 E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: false }).first().fill('correct-horse-battery');
  await page.getByRole('button', { name: /sign up|register|create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

/** Create a document through the §14.1.2 modal. */
async function createViaModal(
  page: Page,
  type: 'Form' | 'Page' | 'Portfolio',
  name: string,
  template?: string,
): Promise<void> {
  await page.getByRole('button', { name: 'New document' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('radio', { name: type }).check();
  if (template) {
    await dialog.getByRole('radio', { name: 'Template' }).check();
    await dialog.getByLabel('Template').selectOption({ label: template });
  }
  await dialog.getByRole('button', { name: 'Create document' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('T07 documents (dashboard + PATCH autosave)', () => {
  test.beforeEach(async ({ page }) => {
    await register(page);
  });

  // ---------------------------------------------------------------- AC4 ----
  test('dashboard lists documents with correct badges; create modal makes the right DocumentBody per type', async ({
    page,
    context,
  }) => {
    await createViaModal(page, 'Form', 'E2E feedback form');
    await createViaModal(page, 'Page', 'E2E launch page');

    const cards = page.locator('.ff-doc-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('E2E launch page');
    await expect(cards.first()).toContainText('Page');
    await expect(cards.first()).toContainText('Draft');
    await expect(cards.nth(1)).toContainText('Form');

    // The create modal produced the right EMPTY DocumentBody per type (§7):
    // fresh skeleton, no blocks, no endings, no rules — for BOTH types.
    const list = await context.request.get('/api/v1/documents');
    expect(list.ok()).toBeTruthy();
    const { data } = (await list.json()) as {
      data: { id: string; type: string; title: string }[];
    };
    for (const item of data) {
      const detail = await context.request.get(`/api/v1/documents/${item.id}`);
      const doc = (await detail.json()) as {
        type: string;
        body: { type: string; blocks: unknown[]; endings: unknown[]; logic: { rules: unknown[] } };
      };
      expect(doc.type).toBe(item.type);
      expect(doc.body.type).toBe(item.type);
      expect(doc.body.blocks).toEqual([]);
      expect(doc.body.endings).toEqual([]);
      expect(doc.body.logic.rules).toEqual([]);
      docId = item.id;
    }
  });

  // ---------------------------------------------------------------- AC3 ----
  test('invalid ops are rejected with the §4 error shape and field details', async ({
    context,
  }) => {
    const created = await context.request.post('/api/v1/documents', {
      data: { type: 'form', title: 'E2E invalid ops' },
    });
    expect(created.status()).toBe(201);
    docId = ((await created.json()) as { id: string }).id;

    // Unknown block reference → 422 VALIDATION, §4 envelope, field detail path.
    const res = await context.request.patch(`/api/v1/documents/${docId}`, {
      data: { baseRev: 0, ops: [{ op: 'block.update', id: 'ghost', props: { label: 'x' } }] },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()) as {
      error: {
        code: string;
        message: string;
        details?: { path: string; message: string }[];
      };
    };
    expect(body.error.code).toBe('VALIDATION');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details?.some((d) => d.path === 'ops[0].id')).toBe(true);
  });

  // ---------------------------------------------------------------- AC1 ----
  // BLOCKED ON T08 (builder page /d/:id with canvas + autosave wiring).
  test.fixme('create form → edit hero → reload: exact state preserved', async ({ page }) => {
    await createViaModal(page, 'Form', 'E2E hero persistence');
    await page.locator('.ff-doc-title', { hasText: 'E2E hero persistence' }).click();
    await expect(page).toHaveURL(/\/d\//);

    // Edit the hero headline through the builder canvas/settings pane (T08).
    const headline = page.getByLabel('Headline');
    await headline.fill('Reload-proof headline');
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 2000 }); // §8 indicator ≤2s

    await page.reload();
    await expect(page.getByLabel('Headline')).toHaveValue('Reload-proof headline');
    // And the API agrees (server-side proof, not just client state):
    const res = await page.context().request.get(`/api/v1/documents/${docId}`);
    const doc = (await res.json()) as { body: { blocks: { props: Record<string, unknown> }[] } };
    expect(doc.body.blocks.some((b) => b.props['headline'] === 'Reload-proof headline')).toBe(true);
  });

  // ---------------------------------------------------------------- AC2 ----
  // BLOCKED ON T08 (needs two live builder tabs driving the autosave queue).
  test.fixme('two tabs editing: stale baseRev gets 409 with current rev+body, client recovers', async ({
    context,
  }) => {
    const created = await context.request.post('/api/v1/documents', {
      data: { type: 'form', title: 'E2E two tabs' },
    });
    expect(created.status()).toBe(201);
    docId = ((await created.json()) as { id: string }).id;

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await tabA.goto(`/d/${docId}`);
    await tabB.goto(`/d/${docId}`);
    await expect(tabA.getByText('Saved')).toBeVisible();
    await expect(tabB.getByText('Saved')).toBeVisible();

    // Tab A edits → rev bumps on the server. Tab B (stale) edits next.
    await tabA.getByLabel('Headline').fill('From tab A');
    await expect(tabA.getByText('Saved')).toBeVisible();
    await tabB.getByLabel('Headline').fill('From tab B');

    // Tab B must recover WITHOUT data loss: the chip passes through the
    // conflict state (the 409 carries the current rev + body) and tab B's
    // edit survives after the client refetches + reapplies (spec §8).
    await expect(tabB.getByText('Saved')).toBeVisible({ timeout: 5000 });
    const res = await context.request.get(`/api/v1/documents/${docId}`);
    const doc = (await res.json()) as { body: { blocks: { props: Record<string, unknown> }[] } };
    const headlines = doc.body.blocks.map((b) => b.props['headline']);
    expect(headlines).toContain('From tab B'); // no data loss
  });
});

export { docId as _docId, createViaModal as _createViaModal };
export type { APIRequestContext };
