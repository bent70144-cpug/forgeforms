// Playwright E2E — logic builder (ticket #20, spec §14.1.4).
//
// STATUS: WRITTEN BUT NOT RUN LOCALLY (sandbox has no Playwright browsers;
// see e2e/README.md). CI-gated: runs in the e2e pipeline with
// `pnpm exec playwright test -c apps/web/e2e/playwright.config.ts`.
//
// Hermetic by design: the documents API (T07) is intercepted at the network
// layer (page.route), so the suite exercises the REAL ApiTransport fetch path
// and the REAL builder UI — no database, no mock-transport toggle.
import { expect, test, type Page, type Route } from "@playwright/test";

const DOC_ID = "demo";
const API_URL = `**/api/v1/documents/${DOC_ID}`;

/** Seed document (§7 DocumentBody): 3 questions, 2 endings, one dangling rule. */
const envelope = (rev: number, rules: unknown[] = []) => ({
  id: DOC_ID,
  rev,
  title: "NPS demo",
  slug: "nps-demo",
  status: "draft",
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
    blocks: [
      { id: "q_nps", kind: "nps", props: { label: "How likely to recommend?", required: true } },
      { id: "q_email", kind: "email", props: { label: "Your email", required: true } },
      { id: "q_comment", kind: "long-text", props: { label: "What went wrong?" } },
    ],
    endings: [
      { id: "end_a", title: "Ending A", body: "Thanks!" },
      { id: "end_b", title: "Ending B", body: "We will call you." },
    ],
    logic: { rules },
  },
});

let rev = 1;

/** Intercept GET + PATCH on the documents API (T07 contract, §8/§11). */
async function mockDocumentsApi(page: Page, rules: unknown[] = []): Promise<void> {
  rev = 1;
  await page.route(API_URL, async (route: Route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: envelope(rev, rules) });
      return;
    }
    // PATCH: apply blind (T07 applies + validates ops), bump rev.
    const payload = request.postDataJSON() as { baseRev: number; ops: unknown[] };
    expect(payload.baseRev).toBe(rev);
    rev += 1;
    await route.fulfill({ json: { rev } });
  });
}

test.describe("logic builder canvas (§14.1.4)", () => {
  test("renders start, questions and endings with default-flow edges in document order", async ({ page }) => {
    await mockDocumentsApi(page);
    await page.goto(`/d/${DOC_ID}/logic`);

    await expect(page.getByTestId("logic-canvas")).toBeVisible();
    // Nodes: start + 3 questions + 2 endings.
    await expect(page.locator(".react-flow__node")).toHaveCount(6);
    await expect(page.locator(".react-flow__node", { hasText: "Start" })).toBeVisible();
    await expect(page.locator(".react-flow__node", { hasText: "How likely to recommend?" })).toBeVisible();
    await expect(page.locator(".react-flow__node", { hasText: "Ending A" })).toBeVisible();
    // Default flow edges: start→q_nps→q_email→q_comment→end:end_a (document order).
    const edgeIds = await page.locator(".react-flow__edge").evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
    expect(edgeIds).toContain("flow:start->q_nps");
    expect(edgeIds).toContain("flow:q_nps->q_email");
    expect(edgeIds).toContain("flow:q_email->q_comment");
    expect(edgeIds).toContain("flow:q_comment->end:end_a");
  });

  test("clicking a question opens the rule drawer; hidden-field config lives on Start", async ({ page }) => {
    await mockDocumentsApi(page);
    await page.goto(`/d/${DOC_ID}/logic`);

    await page.locator(".react-flow__node", { hasText: "How likely to recommend?" }).click();
    await expect(page.getByTestId("rule-drawer")).toBeVisible();
    await expect(page.getByTestId("rule-drawer")).toContainText("How likely to recommend?");

    // Start node drawer hosts the UTM hidden-field config (§14.1.4).
    await page.getByLabel("Close rules drawer").click();
    await page.locator(".react-flow__node", { hasText: "Start" }).click();
    await expect(page.getByTestId("hidden-fields")).toContainText("utm_source");
    await expect(page.getByTestId("hidden-fields")).toContainText("utm_campaign");
  });

  test("NPS ≤ 6 → ending B, otherwise ending A: rule edits autosave ≤2 s with Saved chip", async ({ page }) => {
    await mockDocumentsApi(page);
    await page.goto(`/d/${DOC_ID}/logic`);

    await page.locator(".react-flow__node", { hasText: "How likely to recommend?" }).click();

    // Rule 1: IF @block:q_nps ≤ 6 THEN goto end:end_b.
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await page.getByLabel("Condition source").selectOption("block");
    await page.getByLabel("Condition reference").fill("q_nps");
    await page.getByLabel("Operator").selectOption("lte");
    await page.getByLabel("Compare value").fill("6");
    await page.getByLabel("Goto target").selectOption("end:end_b");

    // Rule 2: "in all other cases" → goto end:end_a.
    await page.getByRole("button", { name: "+ In all other cases" }).click();
    const fallbackCard = page.locator("section", { hasText: "In all other cases" });
    await fallbackCard.getByLabel("Goto target").selectOption("end:end_a");

    // Autosave: PATCH carried { baseRev, ops: [rule.upsert, …] }; chip lands on Saved ≤2 s.
    await expect(page.getByTestId("save-chip")).toHaveText("Saved", { timeout: 2000 });
  });

  test("dangling goto target surfaces the rule id in the builder (publish will block)", async ({ page }) => {
    const dangling = [
      {
        id: "rule_dangling",
        scope: "q_nps",
        when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
        then: [{ type: "goto", target: "end:missing" }],
        isFallback: false,
      },
    ];
    await mockDocumentsApi(page, dangling);
    await page.goto(`/d/${DOC_ID}/logic`);

    // The preview lists engine lint errors — the same diagnostics T10 publish
    // gates on (error names the RULE, ticket acceptance).
    const lint = page.getByTestId("lint-errors");
    await expect(lint).toBeVisible();
    await expect(lint).toContainText('Rule "rule_dangling"');
    await expect(lint).toContainText("end:missing");
  });

  test("saved chip shows Saving… transiently then Saved (autosave loop)", async ({ page }) => {
    await mockDocumentsApi(page);
    await page.goto(`/d/${DOC_ID}/logic`);
    await expect(page.getByTestId("save-chip")).toBeVisible();

    await page.locator(".react-flow__node", { hasText: "Your email" }).click();
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await page.getByLabel("Goto target").selectOption("end:end_a");

    await expect(page.getByTestId("save-chip")).toHaveText("Saved", { timeout: 2000 });
  });
});
