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
//
// Wave 4 additions (W13, describes 11–15) — e2e cases for the wave-4 agent
// packages. PREREQUISITES (branch that must merge before the case can pass):
//   11. stale-batch conflict dialog — agent/w1-conflict-flow (follow-up #2:
//       stale §22.2 batches → §7.3 conflict flow via wiring.planRecovery).
//       Detects the dialog at runtime; against the current build (pre-W1) the
//       stale record routes to the §7.2 discard-only RestorePrompt, so the
//       case self-skips with that reason until W1 lands.
//   12. 401 re-auth prompt — agent/w2-reauth-401 (follow-up #3: re-auth
//       handling in the autosave loop). Skips until the prompt exists.
//   13. slug taken suggestion — agent/w4-slug-check (follow-up #5: GET
//       /slug-check availability probe + DocSettings suggestion UI). Skips
//       until the probe/suggestion UI exists (route here is route-mocked).
//   14. asset picker upload/library — agent/w12-asset-picker (§10 modal +
//       §9.1 question image field). Skips until the picker opener exists.
//   15. pointer drag reorder — agent/w6-dnd-drag (follow-up #7: dnd-kit
//       §6.2 drag + drop indicator). Skips until a drag affordance exists;
//       asserts the flipped tree order AND a dispatched block.move op.
// Cases 12–14 pin best-effort selectors (testid first, then accessible
// names) because the components are not on this integration branch yet —
// tighten them when the owning branch merges.
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

/** Minimal 1×1 transparent PNG for the §10 asset-upload happy path (case 14). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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

// ---------------------------------------------------------------------------
// Wave 4 cases (W13). Each targets one wave-4 agent package and self-skips at
// runtime when its prerequisite UI is not on the integration branch yet
// (same graceful pattern as the theme case above) — see the file-header
// PREREQUISITES block for the owning branch per case.
// ---------------------------------------------------------------------------

test.describe("11. stale-batch conflict dialog (§7.2/§7.3 recovery — wave 4 W1)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("a stale §22.2 offline batch opens the §7.3 conflict dialog; 'Use theirs' clears the record", async ({
    page,
  }) => {
    // Serve the document at rev 2 while the stored batch was written against
    // rev 1 → wiring.planRecovery sees baseRev < serverRev → the stale path.
    const envelope: Record<string, unknown> = { ...seedEnvelope(HERMETIC_DOC_ID, contentSeed()), rev: 2 };
    await mockDocumentsApi(page, HERMETIC_DOC_ID, envelope);

    // Seed the §22.2 IndexedDB record BEFORE any app script runs (the queue
    // is read during BuilderPage's load effect). Same DB contract as
    // lib/builder/offline.ts: `formforge_builder` v1 / `pending_batches`.
    await page.addInitScript(async () => {
      const record = {
        docId: "builder-e2e",
        baseRev: 1,
        ops: [{ op: "block.update", id: "q_name", props: { label: "Stale offline edit" } }],
        updatedAt: Date.now(),
      };
      const open = indexedDB.open("formforge_builder", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("pending_batches")) {
          db.createObjectStore("pending_batches", { keyPath: "docId" });
        }
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pending_batches", "readwrite");
        tx.objectStore("pending_batches").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await openBuilder(page, HERMETIC_DOC_ID);

    // Either the §7.3 conflict dialog (wave-4 W1 flow) or the pre-wave §7.2
    // discard-only prompt must appear — never a silent drop of the record.
    const conflict = page.getByTestId("conflict-dialog");
    const restore = page.getByTestId("restore-prompt");
    await expect(conflict.or(restore)).toBeVisible({ timeout: 10_000 });

    if ((await conflict.count()) === 0) {
      test.skip(
        true,
        "wave-4 W1 (agent/w1-conflict-flow) not merged: stale batches still route to the §7.2 discard-only RestorePrompt",
      );
    }

    // §7.3.3: blocking but non-destructive — Escape must NOT dismiss it.
    await expect(conflict).toContainText("This form was changed in another tab or by someone else.");
    await page.keyboard.press("Escape");
    await expect(conflict).toBeVisible();

    // "Use theirs" adopts the server document and deletes the §22.2 record
    // (offline.ts lifecycle: cleared on resolve — never lost silently).
    await conflict.getByRole("button", { name: "Use theirs" }).click();
    await expect(conflict).toBeHidden();
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("formforge_builder", 1);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const value = await new Promise<unknown>((resolve, reject) => {
        const req = db
          .transaction("pending_batches", "readonly")
          .objectStore("pending_batches")
          .get("builder-e2e");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return value;
    });
    expect(stored, "the §22.2 record is cleared after 'Use theirs'").toBeUndefined();
  });
});

test.describe("12. 401 re-auth prompt (§7.1 autosave — wave 4 W2)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("an expired session (401 on autosave) surfaces the re-auth prompt", async ({ page }) => {
    await openHermetic(page, contentSeed());

    // Every PATCH answers 401 — the session expired mid-edit. Registered
    // AFTER mockDocumentsApi, so this handler wins (Playwright matches LIFO);
    // route.fallback() defers the GETs to the seeded handlers.
    await page.route(`**/api/v1/documents/${HERMETIC_DOC_ID}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Session expired" } },
        });
        return;
      }
      await route.fallback();
    });

    // Trigger an edit → the autosave flush (500 ms debounce) → 401.
    const emailCard = cardsOfKind(page, "email");
    await emailCard.click();
    await emailCard.getByTestId("inline-editable").click();
    const inlineInput = emailCard.getByRole("textbox", { name: "Edit Email text" });
    await inlineInput.fill("Company email");
    await inlineInput.press("Enter");

    // Wave-4 W2: the autosave loop must raise a re-auth prompt (not just the
    // generic "Couldn't save — Retry"). Selector breadth until W2 pins the
    // component's testid: likely ids + role=dialog naming.
    const prompt = page
      .getByTestId("reauth-prompt")
      .or(page.getByTestId("auth-prompt"))
      .or(page.getByRole("dialog", { name: /session expired|re-?auth|sign in/i }));
    await prompt.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    if ((await prompt.count()) === 0) {
      test.skip(
        true,
        "wave-4 W2 (agent/w2-reauth-401) not merged: no re-auth prompt in the autosave loop yet",
      );
    }
    await expect(prompt.first()).toBeVisible();
  });
});

test.describe("13. slug availability + taken suggestion (§6.6 — wave 4 W4)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("typing a taken slug probes availability, flags it and offers the -2 suggestion", async ({
    page,
  }) => {
    await openHermetic(page, contentSeed());

    // W4 route (the settings-helpers TODO pins the path): debounced
    // availability probe behind the §6.6 slug field. Any slug except the
    // doc's own is "taken" here.
    await page.route(`**/api/v1/documents/${HERMETIC_DOC_ID}/slug-check*`, async (route) => {
      const url = new URL(route.request().url());
      const slug = url.searchParams.get("slug") ?? "";
      const taken = slug !== "" && slug !== "builder-e2e-form";
      await route.fulfill({
        json: taken
          ? { slug, available: false, suggestions: [`${slug}-2`] }
          : { slug, available: true },
      });
    });

    // DocSettings (General tab) shows the slug field while nothing is selected.
    const slugField = page.getByTestId("ff-set-doc-slug");
    await expect(slugField).toBeVisible();
    await slugField.fill("winter-campaign");

    // Probe is debounced (~500 ms) and the probe/suggestion UI is W4's —
    // detect before asserting (theme-case pattern), skip pre-merge.
    const suggestion = page
      .getByTestId("slug-suggestion")
      .or(page.getByRole("button", { name: /winter-campaign-2/ }));
    await suggestion.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    if ((await suggestion.count()) === 0) {
      test.skip(
        true,
        "wave-4 W4 (agent/w4-slug-check) not merged: no slug availability probe/suggestion UI yet",
      );
    }

    await expect(page.getByTestId("doc-settings")).toContainText(/taken|already in use/i);
    await suggestion.first().click();
    await expect(slugField).toHaveValue("winter-campaign-2");
  });
});

test.describe("14. asset picker upload + library (§10/§9.1 — wave 4 W12)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("uploading through the asset picker inserts the asset into the question image field", async ({
    page,
  }) => {
    await openHermetic(page, contentSeed());

    // The §9.1 image field lives in the per-question editor (right pane).
    const emailCard = cardsOfKind(page, "email");
    await emailCard.click();
    await expect(page.getByTestId("block-settings")).toBeVisible();

    // W12 opener — testid first, then plausible accessible names.
    const opener = page
      .getByTestId("asset-picker-open")
      .or(
        page.getByRole("button", {
          name: /choose image|pick image|add image|upload image|browse (assets|library)/i,
        }),
      );
    if ((await opener.count()) === 0) {
      test.skip(
        true,
        "wave-4 W12 (agent/w12-asset-picker) not merged: no asset picker opener in the block editor yet",
      );
    }
    await opener.first().click();
    const picker = page.getByRole("dialog", { name: /asset/i });
    await expect(picker).toBeVisible();

    // Mock the §10 assets API: POST upload → ready asset; GET library → list.
    // (No S3/MinIO in this mode — the §13 lazy asset-picker never touches a
    // real bucket in e2e.)
    const asset = {
      id: "asset_e2e_1",
      filename: "e2e-square.png",
      url: "/uploads/e2e-square.png",
      width: 1,
      height: 1,
      size: PNG_1PX.byteLength,
      status: "ready",
    };
    await page.route("**/api/v1/assets**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        await route.fulfill({ status: 201, json: asset });
        return;
      }
      if (request.method() === "GET") {
        await route.fulfill({ json: { items: [asset], total: 1 } });
        return;
      }
      await route.fallback();
    });

    // Upload tab: the hidden <input type="file"> drives the picker without
    // the OS file dialog (Playwright-recommended upload path).
    const fileInput = picker.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "e2e-square.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });

    // The upload lands in the picker (library grid)…
    const assetCard = picker.getByText("e2e-square.png").first();
    await expect(assetCard).toBeVisible({ timeout: 10_000 });

    // …and the Library tab lists it too (§10 upload/library split; the tab
    // opener is W12's — only assert when it exists).
    const libraryTab = picker.getByRole("tab", { name: /library/i });
    if ((await libraryTab.count()) > 0) {
      await libraryTab.click();
      await expect(picker.getByText("e2e-square.png").first()).toBeVisible();
    }

    // Selecting the asset closes the picker and fills the §9.1 image field.
    const selectable = picker
      .getByRole("button", { name: /e2e-square\.png/i })
      .or(assetCard);
    await selectable.first().click();
    await expect(picker).toBeHidden();
    await expect(page.getByTestId("block-settings")).toContainText("e2e-square.png");
  });
});

test.describe("15. pointer drag reorder (§6.2 — wave 4 W6)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1",
    "hermetic documents-API interception — run in API mode",
  );

  test("pointer-dragging a block reorders the tree and dispatches block.move", async ({ page }) => {
    const api = await openHermetic(page, contentSeed());
    expect(await treeLabels(page)).toEqual(["Full name", "Work email"]);

    // Wave-4 W6: dnd-kit pointer drag. Detect the drag affordance — a
    // dedicated handle or a dnd-kit sortable card. Nothing to drag pre-merge
    // → skip (the keyboard Alt+Arrow path stays covered by case 4).
    const card = cardsOfKind(page, "short-text"); // "Full name" (row 1)
    const handle = card.locator('[data-testid="drag-handle"], [aria-roledescription="sortable"]');
    if ((await handle.count()) === 0 && (await card.getAttribute("aria-roledescription")) !== "sortable") {
      test.skip(
        true,
        "wave-4 W6 (agent/w6-dnd-drag) not merged: no pointer drag affordance on block cards yet",
      );
    }
    const source = (await handle.count()) > 0 ? handle.first() : card;

    const from = await source.boundingBox();
    const to = await cardsOfKind(page, "email").boundingBox(); // drop onto "Work email"
    if (!from || !to) throw new Error("drag source/target cards not visible");

    // dnd-kit pointer sensor: press, move past the ~8 px activation
    // threshold, settle over the target (slightly past its midline so an
    // adjacent swap lands), release.
    await page.mouse.move(from.x + from.width / 2, from.y + Math.min(from.height / 2, 16));
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 4, { steps: 8 });
    await page.mouse.up();

    expect(await treeLabels(page)).toEqual(["Work email", "Full name"]);
    // The REAL autosave loop carried the reorder (route-mocked PATCH captured).
    const patch = api.lastPatch();
    expect(patch, "the drag dispatched an autosave batch").not.toBeNull();
    expect(patch?.ops.some((op) => op.op === "block.move")).toBe(true);
  });
});

