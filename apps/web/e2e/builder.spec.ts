// Playwright E2E — FormForge builder (wave 3a, task 8-b).
//
// STATUS: WRITTEN BUT NOT RUN in the dev sandbox (no Playwright browsers —
// same as documents.spec.ts / logic-builder.spec.ts / a11y.spec.ts; CI runs
// them via `pnpm --filter @formforge/web exec playwright test -c
// e2e/playwright.config.ts`).
//
// Two boot modes are in play (see e2e/README.md):
// - Test 1 exercises the REAL dashboard flow (register → §14.1.2 create modal
//   → open /d/:id) exactly like documents.spec.ts — needs the CI
//   Postgres/Redis stack.
// - Tests 2–10 are hermetic: the documents API (GET/PATCH) is intercepted with
//   `page.route`, so the REAL ApiTransport fetch path + autosave loop run with
//   no database (same technique as logic-builder.spec.ts). They must run in
//   API mode: NEXT_PUBLIC_FF_MOCK_BUILDER=1 would bypass the network entirely
//   (in-memory MockTransport seeded with a different document), so the suite
//   skips itself when that flag is visible.
//
// The suite is serial (a11y.spec.ts convention): the tests tell the §4/§5/§6
// story in order and a broken builder should stop the narrative instead of
// cascading. Each test still seeds + opens its own builder instance, so the
// serial chain is about narrative/diagnostics, not shared server state.
//
// Coverage map (task 8-b):
//   1. builder opens        — dashboard create → /d/:id chrome, no console errors
//   2. add blocks via picker — left-pane "Add block" → palette; canvas "+" quick add
//   3. edit inline + settings — inline label commit, block editor, Required, Saved chip
//   4. reorder keyboard     — Alt+ArrowDown in the tree; Ctrl/Cmd+Z restores
//   5. undo/redo + delete toast — toolbar delete → 8 s toast → Undo → redo chord
//   6. preview              — "Draft preview" dialog, Restart, Esc close
//   7. publish gate         — empty form → IssuesList drawer → fix → Publish enabled
//   8. theme                — Slate Dark preset (skips until the pane opener lands)
//   9. keyboard map         — "?" shortcuts dialog, Cmd/Ctrl+K picker
//  10. a11y spot            — axe scan of the three-pane builder (zero critical)
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  createFormViaModal,
  defaultBlocks,
  MOD,
  mockDocumentsApi,
  openBuilder,
  openDocFromDashboard,
  publishButton,
  recordConsoleErrors,
  register,
  saveChip,
  seedEnvelope,
  treeLabels,
  type BuilderSeed,
} from "./builder-helpers";

const HERMETIC_DOC_ID = "builder-e2e";

test.describe.configure({ mode: "serial" });

/** Route-mocked builder open (hermetic tests 2–10). */
async function openHermetic(page: Page, seed: BuilderSeed = {}): Promise<ReturnType<typeof mockDocumentsApi>> {
  const api = await mockDocumentsApi(page, HERMETIC_DOC_ID, seedEnvelope(HERMETIC_DOC_ID, seed));
  await openBuilder(page, HERMETIC_DOC_ID);
  return api;
}

/** Canvas card locator by kind (ids are random — kind is the stable hook). */
function cardsOfKind(page: Page, kind: string) {
  return page.locator(`[data-testid^="block-card-"][data-block-kind="${kind}"]`);
}

/** The standard hermetic seed: 2 questions + 1 ending. */
function contentSeed(): BuilderSeed {
  return {
    blocks: defaultBlocks(),
    endings: [{ id: "end_thanks", title: "Thanks!", body: "We appreciate it." }],
  };
}

test.describe("1. builder opens (dashboard → /d/:id, real API)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "needs the real documents API (unset NEXT_PUBLIC_FF_MOCK_BUILDER)",
  );

  test("create a blank form, open the builder, chrome renders, no console errors", async ({ page }) => {
    test.setTimeout(90_000); // dev-compile race on a cold route (a11y.spec.ts convention)
    const consoleErrors = recordConsoleErrors(page);

    await register(page);
    const title = `Builder open e2e ${Date.now()}`;
    await createFormViaModal(page, title);
    await openDocFromDashboard(page, title);

    // Builder chrome (§4): shell + top bar + three panes.
    await expect(page.getByTestId("builder-shell")).toBeVisible();
    const topbar = page.getByTestId("builder-topbar");
    await expect(topbar.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    await expect(topbar.getByRole("button", { name: title })).toBeVisible(); // inline title (Click to rename)
    await expect(saveChip(page)).toHaveText("Saved"); // idle chip reads "Saved"

    const canvas = page.getByRole("region", { name: "Form editor" });
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("builder-canvas")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Blocks" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("left-pane")).toBeVisible();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // Blank form: empty canvas + empty tree + the publish gate already counts
    // NO_QUESTIONS + NO_ENDING (§8.1) → "Fix 2 issues" state.
    await expect(page.getByTestId("empty-canvas")).toBeVisible();
    await expect(page.getByTestId("blocks-tree-empty")).toBeVisible();
    await expect(publishButton(page)).toHaveAttribute("data-state", "fix-issues");

    await consoleErrors.expectClean();
  });
});

test.describe("2. add blocks via picker", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("left-pane Add block opens the palette (search + Enter inserts); canvas + quick-add inserts Short text", async ({
    page,
  }) => {
    // Seed WITHOUT an email block so the inserted Email card is unambiguous.
    await openHermetic(page, {
      blocks: [
        { id: "q_name", kind: "short-text", props: { label: "Full name", required: true } },
        { id: "q_desc", kind: "long-text", props: { label: "Anything else?" } },
      ],
      endings: [{ id: "end_thanks", title: "Thanks!", body: "We appreciate it." }],
    });
    const tree = page.getByTestId("blocks-tree");
    await expect(tree.getByRole("treeitem")).toHaveCount(2);

    // --- palette path (left pane "Add block") --------------------------------
    // "Add block" emits ff:open-picker with no target → the picker appends at
    // the end of the root list (useBlockPicker.append semantics).
    await page.getByTestId("left-pane").getByRole("button", { name: "Add block" }).click();
    const picker = page.getByRole("dialog", { name: "Add a block" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("textbox", { name: "Search blocks" })).toBeVisible();

    await picker.getByRole("textbox", { name: "Search blocks" }).fill("email");
    await expect(picker.getByRole("option", { name: /Email/ }).first()).toBeVisible();
    await page.keyboard.press("Enter"); // inserts the highlighted option
    await expect(picker).toBeHidden();

    const emailCard = cardsOfKind(page, "email");
    await expect(emailCard).toHaveCount(1);
    await expect(emailCard).toContainText("Email address"); // createBlock defaultProps label
    await expect(tree.getByRole("treeitem", { name: /Email address/ })).toHaveCount(1);

    // --- canvas "+" insertion row (root index 0) -----------------------------
    // Wave 3: the row emits ff:open-picker and the BlockPicker is the single
    // insertion surface (the wave-1 quick-menu fallback was removed).
    const topRow = page.locator('[data-testid="insertion-row"][data-insert-index="0"][data-insert-parent="root"]');
    await topRow.getByRole("button", { name: "Insert block here" }).click();
    const pickerAgain = page.getByRole("dialog", { name: "Add a block" });
    await expect(pickerAgain).toBeVisible();
    await pickerAgain.getByRole("textbox", { name: "Search blocks" }).fill("short");
    await page.keyboard.press("Enter");
    await expect(pickerAgain).toBeHidden();

    await expect(cardsOfKind(page, "short-text")).toHaveCount(2); // seeded "Full name" + new one
    // Inserted at root index 0 → first tree row (tree order == canvas order).
    expect(await treeLabels(page)).toEqual([
      "Short text question",
      "Full name",
      "Anything else?",
      "Email address",
    ]);
  });
});

test.describe("3. edit inline + settings", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("inline label edit commits; the right pane shows the block editor; Required toggles and autosaves", async ({
    page,
  }) => {
    const api = await openHermetic(page, contentSeed());

    const emailCard = cardsOfKind(page, "email");
    await emailCard.click(); // select → right pane switches to the block editor
    await expect(page.getByTestId("block-settings")).toBeVisible();

    // Inline edit: click the label → input → type → Enter commits (§5.2/§6.5).
    await emailCard.getByTestId("inline-editable").click();
    const inlineInput = emailCard.getByRole("textbox", { name: "Edit Email text" });
    await expect(inlineInput).toBeVisible();
    await inlineInput.fill("Company email");
    await inlineInput.press("Enter");

    await expect(emailCard.getByTestId("inline-editable")).toHaveText("Company email");
    await expect(page.getByTestId("blocks-tree").getByRole("treeitem", { name: /Company email/ })).toBeVisible();

    // Required toggle (immediate op, §6.6) → chip lands on "Saved" ≤ 3 s (§8).
    await page.getByTestId("ff-set-required").click();
    await expect(page.getByTestId("ff-set-required")).toBeChecked();
    await expect(saveChip(page)).toHaveText("Saved", { timeout: 3_000 });

    // The REAL ApiTransport carried the edits (route-mocked PATCH captured).
    const patch = api.lastPatch();
    expect(patch).not.toBeNull();
    expect(patch?.ops.some((op) => op.op === "block.update")).toBe(true);
  });
});

test.describe("4. reorder keyboard", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("Alt+ArrowDown moves the focused block down; Ctrl/Cmd+Z restores the order", async ({ page }) => {
    await openHermetic(page, contentSeed());
    expect(await treeLabels(page)).toEqual(["Full name", "Work email"]);

    const firstCard = cardsOfKind(page, "short-text"); // "Full name"
    await firstCard.click(); // focus + select the card, then the §6.5 chord
    await page.keyboard.press("Alt+ArrowDown");
    expect(await treeLabels(page)).toEqual(["Work email", "Full name"]);

    await page.keyboard.press(`${MOD}+z`);
    expect(await treeLabels(page)).toEqual(["Full name", "Work email"]);
  });
});

test.describe("5. undo/redo + delete toast", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("toolbar delete raises the 8 s undo toast; Undo restores; Cmd/Ctrl+Shift+Z redoes the delete", async ({
    page,
  }) => {
    await openHermetic(page, contentSeed());
    const tree = page.getByTestId("blocks-tree");
    const emailCard = cardsOfKind(page, "email");

    await emailCard.click();
    await emailCard.getByRole("button", { name: "Delete block" }).click();

    // NOTE(.last): the wave-3 integration currently mounts UndoToast in BOTH
    // BuilderShell and BuilderPage — two identical toasts stack in the same
    // spot and the LAST one paints on top (only the top one is clickable).
    // .last() addresses the toast that the user actually interacts with in
    // both worlds; the toBeHidden assertions below encode the §6.4
    // single-toast contract and will surface the duplicate mount until
    // wave 3b drops it (reported).
    const toast = page.getByTestId("undo-toast").last();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Deleted Work email");
    await expect(tree.getByRole("treeitem", { name: /Work email/ })).toHaveCount(0);

    // Undo inside the 8 s window (§6.4 — no confirm dialog, toast instead).
    await toast.getByRole("button", { name: "Undo delete of Work email" }).click();
    await expect(toast).toBeHidden();
    await expect(tree.getByRole("treeitem", { name: /Work email/ })).toBeVisible();

    // Redo chord re-applies the delete. Only explicit deletes emit
    // ff:block-deleted, so the toast must NOT reappear.
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(tree.getByRole("treeitem", { name: /Work email/ })).toHaveCount(0);
    await expect(toast).toBeHidden();
  });
});

test.describe("6. preview", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("Draft preview dialog opens, Restart works, Escape closes", async ({ page }) => {
    test.setTimeout(60_000); // the conversational renderer loads via dynamic import
    await openHermetic(page, contentSeed());

    await page.getByTestId("builder-topbar").getByRole("button", { name: "Preview" }).click();
    const preview = page.getByRole("dialog", { name: "Draft preview" });
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("preview-modal").getByText("DRAFT", { exact: true })).toBeVisible();

    // Restart remounts the renderer via a key increment (§8.4) — the dialog
    // stays open and the device toggle survives.
    await page.getByTestId("preview-restart").click();
    await expect(page.getByTestId("preview-device-desktop")).toBeVisible();
    await expect(preview).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("preview-modal")).toBeHidden();
  });
});

test.describe("7. publish gate", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("empty form → Fix 2 issues opens the drawer; adding a question + ending re-enables Publish", async ({
    page,
  }) => {
    // Empty body: no blocks, no endings → NO_QUESTIONS + NO_ENDING (§8.1).
    await openHermetic(page, {});

    const btn = publishButton(page);
    await expect(btn).toHaveAttribute("data-state", "fix-issues");
    await expect(btn).toHaveText(/Fix 2 issues/);

    await btn.click();
    const drawer = page.getByTestId("issues-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("dialog", { name: "Publish issues" })).toBeVisible();
    await expect(page.getByTestId("issues-count")).toContainText("2 blocking issues");
    await expect(drawer.locator('[data-code="NO_QUESTIONS"]')).toBeVisible();
    await expect(drawer.locator('[data-code="NO_ENDING"]')).toBeVisible();
    await expect(drawer).toContainText("Add at least one question before publishing.");
    await expect(drawer).toContainText("Add an ending (thank-you screen) before publishing.");

    // Fix through the UI: quick-add a question from the empty canvas and an
    // ending from the left pane (both work without the picker).
    await page.keyboard.press("Escape"); // Esc closes the issues drawer
    await expect(drawer).toBeHidden();
    await page.getByTestId("empty-canvas").getByRole("button", { name: "Add Email" }).click();
    await page.getByTestId("left-pane").getByRole("button", { name: "Add ending" }).click();

    // Blocking count 0 → the §4 button returns to the enabled "Publish" state.
    // Client-side gate state only — the publish POST itself is not asserted.
    await expect(btn).toHaveAttribute("data-state", "publish");
    await expect(btn).toHaveText("Publish");
  });
});

test.describe("8. theme", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("Slate Dark preset repaints the canvas background", async ({ page }) => {
    await openHermetic(page, contentSeed());
    const canvas = page.getByTestId("builder-canvas");
    await expect(canvas).toHaveCSS("background-color", "rgb(255, 255, 255)"); // default --ff-bg

    // The right pane renders ThemePanel only when the store panel is "theme".
    // NOTE: no control in the current components dispatches setPanel("theme")
    // (the only setPanel call sites are LeftPane/Canvas → endings, PublishControl
    // → block) — the right-pane tab row is landing with the wave-3 integration.
    // Skip gracefully until the opener exists; every selector below is REAL.
    const opener = page
      .getByRole("tab", { name: "Theme" })
      .or(page.getByRole("button", { name: "Theme", exact: true }));
    if ((await opener.count()) === 0) {
      test.skip(true, "no Theme opener control in the right pane yet (wave-3 integration pending)");
    }
    await opener.first().click();
    await expect(page.getByTestId("theme-panel")).toBeVisible();

    const slateDark = page
      .getByRole("group", { name: "Theme presets" })
      .locator('button[data-preset-id="slate-dark"]');
    await expect(slateDark).toHaveAttribute("aria-pressed", "false");
    await slateDark.click();
    await expect(slateDark).toHaveAttribute("aria-pressed", "true");

    // #0F172A applied through the live --ff-bg variable (Canvas §5.1).
    await expect(canvas).toHaveCSS("background-color", "rgb(15, 23, 42)");
  });
});

test.describe("9. keyboard map", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("'?' opens the shortcuts dialog (Esc closes); Cmd/Ctrl+K opens the picker", async ({ page }) => {
    await openHermetic(page, contentSeed());

    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("Open block picker");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();

    await page.keyboard.press(`${MOD}+k`);
    const picker = page.getByRole("dialog", { name: "Add a block" });
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
  });
});

test.describe("10. a11y spot (axe)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("zero critical axe violations on the three-pane builder (a11y.spec.ts gate)", async ({ page }) => {
    test.setTimeout(90_000);
    await openHermetic(page, contentSeed());

    // Same gate as a11y.spec.ts: zero CRITICAL violations (§14.4).
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((violation) => violation.impact === "critical");
    const summary = critical
      .map(
        (violation) =>
          `${violation.id} (${violation.nodes.length} nodes): ${violation.nodes
            .map((node) => node.target.join(" "))
            .join("; ")}`,
      )
      .join("\n");
    expect(
      critical,
      `[builder] critical axe violations:\n${summary}\n` +
        `(all impacts present: ${results.violations.map((violation) => `${violation.id}:${violation.impact}`).join(", ")})`,
    ).toEqual([]);
  });
});

