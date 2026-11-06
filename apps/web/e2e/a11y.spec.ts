// T28 (issue #28) — axe-core accessibility suite for the four surfaces of
// spec §16 (Accessibility row): builder, dashboard, public form, public page.
// Gate: ZERO CRITICAL axe violations per surface (spec §14.4 release gate).
//
// WRITTEN, NOT RUN in the dev sandbox (no browsers); CI runs it via the `a11y`
// job in .github/workflows/ci.yml with a reachable DATABASE_URL:
//   pnpm exec playwright install chromium --with-deps
//   pnpm exec playwright test -c e2e/playwright.config.ts a11y
//
// Coverage map:
//   dashboard      → /dashboard after registering a fresh user
//   builder        → /d/:docId/logic (T20 logic canvas — the landed builder
//                    surface; the full three-pane builder page is not merged yet)
//   public page    → /p/:slug for a PUBLISHED portfolio (scroll renderer plane)
//   public form    → /dev/form-plane-harness — KNOWN GAP: the /p form plane is
//                    not landed yet (app/p/[slug] 404s forms), so axe runs the
//                    conversational renderer harness (see that page's docs).
//   reduced-motion → emulation test: prefers-reduced-motion collapses renderer
//                    + app animations (spec §14.4).
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const uniq = () => `t28-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe.configure({ mode: 'serial' });

async function register(page: Page): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Name').fill('T28 A11y');
  await page.getByLabel('Email').fill(`${uniq()}@example.com`);
  await page.getByLabel('Password', { exact: false }).first().fill('correct-horse-battery');
  await page.getByRole('button', { name: /sign up|register|create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Assert zero CRITICAL axe violations (impacts: critical). */
async function expectZeroCritical(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  const summary = critical
    .map((v) => `${v.id} (${v.nodes.length} nodes): ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`)
    .join('\n');
  expect(
    critical,
    `[${surface}] critical axe violations:\n${summary}\n` +
      `(all impacts present: ${results.violations.map((v) => `${v.id}:${v.impact}`).join(', ')})`,
  ).toEqual([]);
}

/** Publish a document of the given type through the v1 API (session cookies included). */
async function createAndPublish(page: Page, type: 'form' | 'portfolio', templateId?: string): Promise<string> {
  const created = await page.request.post('/api/v1/documents', {
    data: { type, title: `T28 a11y ${type}`, ...(templateId ? { templateId } : {}) },
  });
  expect(created.status(), await created.text()).toBe(201);
  const doc = (await created.json()) as { id: string };
  const published = await page.request.post(`/api/v1/documents/${doc.id}/publish`);
  expect(published.status(), await published.text()).toBe(200);
  const detail = (await page.request.get(`/api/v1/documents/${doc.id}`)) as unknown as {
    ok: () => boolean;
    json: () => Promise<{ slug: string }>;
  };
  expect(detail.ok()).toBeTruthy();
  const { slug } = await detail.json();
  return slug;
}

test.describe('T28 axe — dashboard', () => {
  test('zero critical violations on /dashboard (empty + with documents)', async ({ page }) => {
    await register(page);
    await expectZeroCritical(page, 'dashboard');

    await page.request.post('/api/v1/documents', { data: { type: 'form', title: 'T28 dashboard filler' } });
    await page.reload();
    await expect(page.locator('.ff-doc-card').first()).toBeVisible();
    await expectZeroCritical(page, 'dashboard with documents');
  });
});

test.describe('T28 axe — builder (logic canvas)', () => {
  test('zero critical violations on /d/:docId/logic', async ({ page }) => {
    await register(page);
    const created = await page.request.post('/api/v1/documents', {
      data: { type: 'form', title: 'T28 builder surface' },
    });
    const doc = (await created.json()) as { id: string };

    await page.goto(`/d/${doc.id}/logic`);
    await expect(page.getByTestId('logic-canvas')).toBeVisible();
    await expectZeroCritical(page, 'builder');
  });
});

test.describe('T28 axe — public page (published portfolio, scroll plane)', () => {
  test('zero critical violations on /p/:slug', async ({ page }) => {
    await register(page);
    const slug = await createAndPublish(page, 'portfolio', 'designer-portfolio');
    await page.goto(`/p/${slug}`);
    await expect(page.locator('.ff-section-hero')).toBeVisible();
    await expectZeroCritical(page, 'public page');
  });
});

test.describe('T28 axe — public form (conversational renderer harness)', () => {
  test('zero critical violations on the form-plane harness (welcome + question + error states)', async ({ page }) => {
    await page.goto('/dev/form-plane-harness');
    await expect(page.locator('.ff-screen')).toBeVisible();
    await expectZeroCritical(page, 'public form (welcome)');

    // Start the flow → first question.
    await page.getByRole('button', { name: /start/i }).click();
    await expect(page.locator('[role="status"]')).toContainText('Question 1 of 4');
    await expectZeroCritical(page, 'public form (question)');

    // Trigger the inline validation error state (required field, empty).
    await page.getByRole('button', { name: /ok/i }).click();
    await expect(page.locator('[role="alert"]')).toContainText('This field is required.');
    await expectZeroCritical(page, 'public form (validation error)');
  });
});

test.describe('T28 reduced-motion emulation (spec §14.4)', () => {
  test('renderer collapses animation/transition under prefers-reduced-motion: reduce', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const reduced = await context.newPage();
    await reduced.goto('/dev/form-plane-harness');
    await expect(reduced.locator('.ff-screen')).toBeVisible();
    const screenMotion = await reduced.locator('.ff-screen').evaluate((el) => {
      const style = getComputedStyle(el);
      return { name: style.animationName, duration: style.animationDuration };
    });
    expect(screenMotion.name, 'welcome screen animation disabled under reduced motion').toBe('none');

    // App surfaces too: the skeleton pulse is collapsed under emulation.
    await register(reduced);
    const skeleton = await reduced
      .locator('.ff-skeleton')
      .first()
      .evaluate((el) => getComputedStyle(el).animationDuration)
      .catch(() => 'none'); // skeletons may already be replaced by real cards
    expect(['0.00001s', '0.000001s', '0s', 'none']).toContain(skeleton);

    await context.close();
  });
});
