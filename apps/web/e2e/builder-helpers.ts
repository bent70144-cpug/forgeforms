// Shared helpers for e2e/builder.spec.ts (builder milestone E2E, wave 3a).
//
// Conventions mirror the existing suites:
// - documents.spec.ts  → register() + createViaModal() for the REAL dashboard
//                        flow (needs the CI Postgres/Redis stack).
// - logic-builder.spec.ts → hermetic `page.route` interception of the documents
//                        API (GET/PATCH) so the REAL ApiTransport fetch path and
//                        the REAL builder UI run with no database at all.
//
// No new dependencies: only @playwright/test + @axe-core/playwright (devDeps).
import { expect, type Page, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Document envelope seed (§7 DocumentBody shape — same as logic-builder.spec)
// ---------------------------------------------------------------------------

export type SeedBlock = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: SeedBlock[];
};

export type BuilderSeed = {
  title?: string;
  slug?: string;
  status?: "draft" | "published" | "archived";
  blocks?: SeedBlock[];
  endings?: Array<{ id: string; title: string; body?: string }>;
  rules?: unknown[];
};

export function seedEnvelope(docId: string, seed: BuilderSeed = {}): Record<string, unknown> {
  return {
    id: docId,
    rev: 1,
    title: seed.title ?? "Builder E2E form",
    slug: seed.slug ?? "builder-e2e-form",
    status: seed.status ?? "draft",
    type: "form",
    updatedAt: new Date().toISOString(),
    body: {
      schemaVersion: 1,
      type: "form",
      theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
      settings: {
        seo: {},
        locale: "en",
        progressBar: true,
        autoAdvance: true,
        showBranding: true,
        captcha: false,
        notifyEmails: [],
      },
      blocks: seed.blocks ?? [],
      endings: seed.endings ?? [],
      logic: { rules: seed.rules ?? [] },
    },
  };
}

/** Two question blocks + one ending — the "has content" default seed. */
export function defaultBlocks(): SeedBlock[] {
  return [
    { id: "q_name", kind: "short-text", props: { label: "Full name", required: true } },
    { id: "q_email", kind: "email", props: { label: "Work email", required: false } },
  ];
}

export function defaultSeed(docId: string): Record<string, unknown> {
  return seedEnvelope(docId, {
    blocks: defaultBlocks(),
    endings: [{ id: "end_thanks", title: "Thanks!", body: "We appreciate it." }],
  });
}

// ---------------------------------------------------------------------------
// Hermetic documents API (mirrors logic-builder.spec.ts mockDocumentsApi)
// ---------------------------------------------------------------------------

export type PatchPayload = { baseRev: number; ops: Array<Record<string, unknown>> };

export type MockedDocumentsApi = {
  /** Revision the mock server is currently at (bumped on every PATCH). */
  rev: () => number;
  /** Latest PATCH payload the client sent (for op-level assertions). */
  lastPatch: () => PatchPayload | null;
  /** Latest publish POST payload (expectedRev) — publish is never fulfilled OK. */
  lastPublishBody: () => Record<string, unknown> | null;
};

/**
 * Intercept GET + PATCH on the documents route for `docId` (the same glob
 * style logic-builder.spec.ts uses) so the builder loads the given envelope
 * and autosave round-trips without a database. GET always
 * returns the STATIC seed (the route never replays client edits — exactly like
 * logic-builder.spec.ts; the tests assert CLIENT state, not server state).
 *
 * The publish endpoint is deliberately NOT intercepted: the publish-gate test
 * asserts client-side gate state only and never completes a publish.
 */
export async function mockDocumentsApi(page: Page, docId: string, envelope: Record<string, unknown>): Promise<MockedDocumentsApi> {
  let rev = typeof envelope.rev === "number" ? envelope.rev : 1;
  let lastPatch: PatchPayload | null = null;
  let lastPublishBody: Record<string, unknown> | null = null;

  await page.route(`**/api/v1/documents/${docId}`, async (route: Route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: envelope });
      return;
    }
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON() as { baseRev: number; ops: Array<Record<string, unknown>> };
      lastPatch = payload;
      rev += 1;
      await route.fulfill({ json: { rev } });
      return;
    }
    await route.fulfill({ json: { error: { code: "NOT_IMPLEMENTED", message: "not used by the builder specs" } } });
  });

  // Track (but do not fulfill OK) publish calls so the publish-gate test stays
  // on client-side assertions: a stray POST gets a 401-shaped reply (what the
  // real API answers without a session), and PublishControl surfaces its error
  // message while client state remains consistent.
  await page.route(`**/api/v1/documents/${docId}/publish`, async (route: Route) => {
    const request = route.request();
    if (request.method() === "POST") {
      lastPublishBody = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    }
    await route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "login required" } } });
  });

  return {
    rev: () => rev,
    lastPatch: () => lastPatch,
    lastPublishBody: () => lastPublishBody,
  };
}

// ---------------------------------------------------------------------------
// Builder page open + chrome locators
// ---------------------------------------------------------------------------

/** Navigate to the builder route and wait until the shell is interactive. */
export async function openBuilder(page: Page, docId: string): Promise<void> {
  await page.goto(`/d/${docId}`);
  await expect(page.getByTestId("builder-shell")).toBeVisible();
  await expect(page.getByTestId("builder-topbar")).toBeVisible();
}

/** The top-bar Saving…/Saved chip (`save-indicator.tsx` — no testid, unique class). */
export function saveChip(page: Page) {
  return page.getByTestId("builder-topbar").locator(".ff-save-chip");
}

/** The publish button in any of its §4 states (data-state narrows the variant). */
export function publishButton(page: Page) {
  return page.getByTestId("publish-button");
}

/** Ordered display labels of the left-pane blocks tree (canvas order — both walk the body depth-first). */
export async function treeLabels(page: Page): Promise<string[]> {
  const tree = page.getByTestId("blocks-tree");
  await expect(tree).toBeVisible();
  return tree.locator('[role="treeitem"] .ff-tree-label').allInnerTexts();
}

// ---------------------------------------------------------------------------
// Keyboard helpers (spec §6.5 — meta is Cmd on darwin, Ctrl elsewhere)
// ---------------------------------------------------------------------------

export const IS_MAC = process.platform === "darwin";
export const MOD = IS_MAC ? "Meta" : "Control";

// ---------------------------------------------------------------------------
// Console error collection (test 1 — "no console errors")
// ---------------------------------------------------------------------------

/** Dev-mode noise that is NOT a builder defect (kept deliberately short). */
const BENIGN_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /React DevTools/i,
  // Browser-level resource noise unrelated to the builder surface:
  /favicon/i,
  /third-party cookie/i,
  /Autofocus processing/i,
];

export type ConsoleRecorder = {
  /** Non-benign console.error texts collected so far. */
  errors: () => string[];
  /** Assert no non-benign console errors were recorded. */
  expectClean: () => Promise<void>;
};

/** Attach a console-error recorder to the page (call BEFORE the first goto). */
export function recordConsoleErrors(page: Page): ConsoleRecorder {
  const raw: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") raw.push(message.text());
  });
  page.on("pageerror", (error) => raw.push(`pageerror: ${error.message}`));
  return {
    errors: () => raw.filter((text) => !BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))),
    async expectClean() {
      const remaining = raw.filter((text) => !BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text)));
      expect(remaining, `console errors on ${page.url()}:\n${remaining.join("\n")}`).toEqual([]);
    },
  };
}

// ---------------------------------------------------------------------------
// Dashboard helpers (REAL API — mirrors documents.spec.ts register/createViaModal)
// ---------------------------------------------------------------------------

const uniq = () => `t8b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Register a fresh user (T03 flow) and land on the dashboard. */
export async function register(page: Page): Promise<string> {
  const email = `${uniq()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name").fill("Builder E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: false }).first().fill("correct-horse-battery");
  await page.getByRole("button", { name: /sign up|register|create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

/** Create a blank Form through the §14.1.2 modal and return to the dashboard. */
export async function createFormViaModal(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New document" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("radio", { name: "Form" }).check();
  await dialog.getByRole("button", { name: "Create document" }).click();
  await expect(dialog).toBeHidden();
}

/** Open the document with the given title from the dashboard cards. */
export async function openDocFromDashboard(page: Page, title: string): Promise<void> {
  await page.locator(".ff-doc-card").filter({ hasText: title }).locator(".ff-doc-title").first().click();
  await expect(page).toHaveURL(/\/d\//);
}
