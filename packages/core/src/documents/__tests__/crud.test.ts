// T07 — documents CRUD service tests (spec §6, §8, §11; DB-free: in-memory repo).
import { describe, expect, it } from "vitest";
import {
  makeArchiveDocument,
  makeCreateDocument,
  makeDuplicateDocument,
  makeGetDocument,
  makeListDocuments,
  makePatchDocument,
  RevConflictError,
  type CrudDeps,
} from "../crud";
import { createInMemoryCrudDocumentStore, type InMemoryCrudDocumentStore } from "../crud-inmemory";
import { type Ctx } from "../../shared/ctx.ts";;
import { defaultDraftValidator } from "../validation";
import type { DraftValidationIssue } from "../ports";
import type { DocumentBodyJson } from "../model";

/**
 * Structural validator with the schema-level duplicate-id check — mirrors the
 * production validator wired in apps/web (built on @formforge/schema's
 * DocumentBody, which rejects duplicate block ids tree-wide).
 */
const parityValidator = {
  async validate(body: unknown): Promise<readonly DraftValidationIssue[]> {
    const issues: DraftValidationIssue[] = [...(await defaultDraftValidator.validate(body))];
    const seen = new Set<string>();
    const walk = (blocks: DocumentBodyJson["blocks"], basePath: string): void => {
      blocks.forEach((block, index) => {
        const path = `${basePath}[${index}]`;
        if (seen.has(block.id)) {
          issues.push({ path: `${path}.id`, message: `Duplicate block id "${block.id}"` });
        } else {
          seen.add(block.id);
        }
        if (block.children) walk(block.children, `${path}.children`);
      });
    };
    walk((body as DocumentBodyJson).blocks ?? [], "blocks");
    return issues;
  },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeClock(start = Date.parse("2026-11-06T10:00:00.000Z")) {
  let current = start;
  return {
    now: () => new Date(current),
    tick: (ms = 1000): void => {
      current += ms;
    },
  };
}

function makeCtx(clock: ReturnType<typeof makeClock>, overrides: Partial<Ctx> = {}): Ctx {
  return {
    workspaceId: "ws_a",
    actor: { type: "user", id: "u_1" },
    requestId: "req_test_1",
    now: clock.now,
    ...overrides,
  };
}

const heroBlock = { id: "h1", kind: "hero", props: { title: "Hello" } };

function draftWith(blocks: DocumentBodyJson["blocks"], type: DocumentBodyJson["type"] = "form"): DocumentBodyJson {
  return {
    schemaVersion: 1,
    type,
    theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
    settings: { seo: {}, locale: "en", progressBar: true, autoAdvance: true, showBranding: true, captcha: false, notifyEmails: [] },
    blocks,
    endings: [],
    logic: { rules: [] },
  };
}

type Harness = {
  store: InMemoryCrudDocumentStore;
  deps: CrudDeps;
  ctx: Ctx;
  clock: ReturnType<typeof makeClock>;
};

function makeHarness(overrides: Partial<CrudDeps> = {}): Harness {
  const clock = makeClock();
  const store = createInMemoryCrudDocumentStore();
  return {
    store,
    deps: { documents: store.documents, validator: parityValidator, ...overrides },
    ctx: makeCtx(clock),
    clock,
  };
}

// ---------------------------------------------------------------------------
// create / get / list
// ---------------------------------------------------------------------------

describe("createDocument", () => {
  it.each(["form", "page", "portfolio"] as const)(
    "creates an empty DocumentBody per type (%s), rev 0, status draft",
    async (type) => {
      const h = makeHarness();
      const result = await makeCreateDocument(h.deps)(h.ctx, { type, title: `My ${type}` });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const doc = result.value;
      expect(doc.type).toBe(type);
      expect(doc.status).toBe("draft");
      expect(doc.rev).toBe(0);
      expect(doc.createdBy).toBe("u_1");
      const body = doc.draft as DocumentBodyJson;
      expect(body.schemaVersion).toBe(1);
      expect(body.type).toBe(type);
      expect(body.blocks).toEqual([]);
      expect(body.endings).toEqual([]);
      expect(body.logic!.rules).toEqual([]);
      expect(body.settings!.locale).toBe("en");
      expect(body.settings!.showBranding).toBe(true);
    },
  );

  it("derives a slug from the title and disambiguates collisions", async () => {
    const h = makeHarness();
    const first = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "Contact Form!" });
    const second = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "Contact Form!" });
    expect(first.ok && first.value.slug).toBe("contact-form");
    expect(second.ok && second.value.slug).toBe("contact-form-2");
  });

  it("rejects an empty title with a §4 field detail", async () => {
    const h = makeHarness();
    const result = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.details).toEqual([{ path: "title", message: expect.any(String) }]);
  });

  it("rejects an unknown type", async () => {
    const h = makeHarness();
    const result = await makeCreateDocument(h.deps)(h.ctx, {
      type: "deck" as "form",
      title: "X",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
  });

  it("uses the provided initial body (template instantiation) and validates it", async () => {
    const h = makeHarness();
    const ok = await makeCreateDocument(h.deps)(h.ctx, {
      type: "form",
      title: "From template",
      initialBody: draftWith([heroBlock]),
    });
    expect(ok.ok && (ok.value.draft as DocumentBodyJson).blocks).toEqual([heroBlock]);

    const bad = await makeCreateDocument(h.deps)(h.ctx, {
      type: "form",
      title: "Broken template",
      initialBody: { ...draftWith([]), blocks: [{ id: "", kind: "hero", props: {} }] },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe("VALIDATION");
    expect(bad.error.details?.length).toBeGreaterThan(0);
  });
});

describe("getDocument", () => {
  it("returns the record and enforces the workspace scope", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const otherWs = makeCtx(h.clock, { workspaceId: "ws_b" });

    const got = await makeGetDocument(h.deps)(h.ctx, created.value.id);
    expect(got.ok && got.value.id).toBe(created.value.id);

    const foreign = await makeGetDocument(h.deps)(otherWs, created.value.id);
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe("NOT_FOUND");
  });
});

describe("listDocuments", () => {
  it("lists ordered by updatedAt desc with cursor pagination and filters", async () => {
    const h = makeHarness();
    const create = makeCreateDocument(h.deps);
    const ids: string[] = [];
    for (const title of ["One", "Two", "Three"]) {
      const r = await create(h.ctx, { type: "form", title });
      if (!r.ok) throw new Error("create failed");
      ids.push(r.value.id);
      h.clock.tick(1000);
    }
    // third document is newest (updated_at desc)
    const page1 = await makeListDocuments(h.deps)(h.ctx, { limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.items.map((d) => d.title)).toEqual(["Three", "Two"]);
    expect(page1.value.nextCursor).not.toBeNull();

    const page2 = await makeListDocuments(h.deps)(h.ctx, { limit: 2, cursor: page1.value.nextCursor });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.items.map((d) => d.title)).toEqual(["One"]);
    expect(page2.value.nextCursor).toBeNull();

    const onlyTwo = await makeListDocuments(h.deps)(h.ctx, { limit: 50, q: "tw" });
    expect(onlyTwo.ok && onlyTwo.value.items.map((d) => d.title)).toEqual(["Two"]);
  });

  it("filters by type and status", async () => {
    const h = makeHarness();
    const create = makeCreateDocument(h.deps);
    const page = await create(h.ctx, { type: "page", title: "Landing" });
    const form = await create(h.ctx, { type: "form", title: "Form" });
    if (!page.ok || !form.ok) throw new Error("create failed");
    await makeArchiveDocument(h.deps)(h.ctx, form.value.id);

    const pages = await makeListDocuments(h.deps)(h.ctx, { limit: 50, type: "page" });
    expect(pages.ok && pages.value.items).toHaveLength(1);
    expect(pages.ok && pages.value.items[0]?.type).toBe("page");

    const drafts = await makeListDocuments(h.deps)(h.ctx, { limit: 50, status: "draft" });
    expect(drafts.ok && drafts.value.items.map((d) => d.title)).toEqual(["Landing"]);
  });
});

// ---------------------------------------------------------------------------
// duplicate / archive
// ---------------------------------------------------------------------------

describe("duplicateDocument", () => {
  it("copies draft, title '(copy)', fresh unique slug, draft status/rev 0", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "page", title: "Portfolio" });
    if (!created.ok) throw new Error("create failed");
    const createdId = created.value.id;
    // simulate edits + publish state on the original
    await makePatchDocument(h.deps)(h.ctx, createdId, {
      baseRev: 0,
      ops: [{ op: "block.insert", index: 0, block: heroBlock }],
    });
    const fresh = await makeGetDocument(h.deps)(h.ctx, createdId);
    if (!fresh.ok) throw new Error("refetch failed");

    const copy = await makeDuplicateDocument(h.deps)(h.ctx, created.value.id);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.id).not.toBe(created.value.id);
    expect(copy.value.title).toBe("Portfolio (copy)");
    expect(copy.value.slug).toBe("portfolio-copy");
    expect(copy.value.status).toBe("draft");
    expect(copy.value.rev).toBe(0);
    expect(copy.value.publishedVersionId).toBeNull();
    expect(copy.value.draft).toEqual(fresh.value.draft);
    expect(copy.value.draft).not.toBe(fresh.value.draft);
  });

  it("404s unknown documents", async () => {
    const h = makeHarness();
    const copy = await makeDuplicateDocument(h.deps)(h.ctx, "00000000-0000-7000-8000-000000000001");
    expect(copy.ok).toBe(false);
    if (copy.ok) return;
    expect(copy.error.code).toBe("NOT_FOUND");
  });
});

describe("archiveDocument", () => {
  it("soft-deletes (status → archived) and bumps updatedAt", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "Old" });
    if (!created.ok) throw new Error("create failed");
    h.clock.tick(5000);
    const archived = await makeArchiveDocument(h.deps)(h.ctx, created.value.id);
    expect(archived.ok && archived.value.status).toBe("archived");
    expect(archived.ok && archived.value.updatedAt.getTime()).toBe(h.clock.now().getTime());
  });
});

// ---------------------------------------------------------------------------
// PATCH (ops + rev/409)
// ---------------------------------------------------------------------------

describe("patchDocument", () => {
  it("applies ops in one batch, increments rev once, persists the draft", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    h.clock.tick(2000);

    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [
        { op: "block.insert", index: 0, block: heroBlock },
        { op: "block.update", id: "h1", props: { title: "Hello world" } },
        { op: "theme.update", patch: { tokens: { "color.bg": "#000000" } } },
      ],
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.value.rev).toBe(1);
    expect(patched.value.updatedAt.getTime()).toBe(h.clock.now().getTime());
    const body = patched.value.draft as DocumentBodyJson;
    expect((body.blocks[0] as { props: Record<string, unknown> }).props["title"]).toBe("Hello world");
    expect(body.theme.tokens["color.bg"]).toBe("#000000");

    const stored = h.store.documents;
    const refetched = await stored.getById("ws_a", created.value.id);
    expect(refetched?.rev).toBe(1);
  });

  it("meta.update changes title and slug at the document level", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "meta.update", patch: { title: "Renamed", slug: "renamed" } }],
    });
    expect(patched.ok && patched.value.title).toBe("Renamed");
    expect(patched.ok && patched.value.slug).toBe("renamed");
  });

  it("409 CONFLICT with the current rev + body on stale baseRev (spec §8)", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    // another tab advances rev
    const other = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "block.insert", index: 0, block: heroBlock }],
    });
    expect(other.ok).toBe(true);

    const stale = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "block.insert", index: 0, block: { id: "x", kind: "text", props: {} } }],
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    const err = stale.error as RevConflictError;
    expect(err.code).toBe("CONFLICT");
    expect(err.currentRev).toBe(1);
    expect((err.currentBody as DocumentBodyJson).blocks).toEqual([heroBlock]);
    expect(err.details).toEqual([{ path: "rev", message: "1" }, { path: "baseRev", message: "have 0" }]);
  });

  it("rejects unknown block references with §4 field details (path ops[i]…)", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "block.remove", id: "ghost" }],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.error.code).toBe("VALIDATION");
    expect(patched.error.details).toEqual([
      { path: "ops[0].id", message: expect.stringContaining("ghost") },
    ]);
    // nothing was persisted
    const stored = await h.store.documents.getById("ws_a", created.value.id);
    expect(stored?.rev).toBe(0);
  });

  it("rejects ops that produce an invalid DocumentBody with validator details", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    // The op applies cleanly (theme patches are raw merges) but the RESULT is
    // invalid → the §8 "validate the result" step must reject the whole patch.
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "theme.update", patch: { radius: "huge" as "md" } }],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.error.code).toBe("VALIDATION");
    expect(patched.error.details?.some((d) => (d.path ?? "").includes("theme.radius"))).toBe(true);
    const stored = await h.store.documents.getById("ws_a", created.value.id);
    expect(stored?.rev).toBe(0);
  });

  it("rejects duplicate block ids (schema-level DocumentBody check)", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [
        { op: "block.insert", index: 0, block: heroBlock },
        { op: "block.insert", index: 1, block: heroBlock },
      ],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.error.code).toBe("VALIDATION");
    expect(patched.error.details?.some((d) => d.message.includes("Duplicate block id"))).toBe(true);
  });

  it("rejects a slug change to an already-taken slug", async () => {
    const h = makeHarness();
    const create = makeCreateDocument(h.deps);
    const a = await create(h.ctx, { type: "form", title: "Alpha" });
    const b = await create(h.ctx, { type: "form", title: "Beta" });
    if (!a.ok || !b.ok) throw new Error("create failed");
    const patched = await makePatchDocument(h.deps)(h.ctx, b.value.id, {
      baseRev: 0,
      ops: [{ op: "meta.update", patch: { slug: a.value.slug } }],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.error.code).toBe("VALIDATION");
    expect(patched.error.details).toEqual([
      { path: "ops[0].patch.slug", message: expect.stringContaining("already in use") },
    ]);
  });

  it("rejects patching an archived document", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "Old" });
    if (!created.ok) throw new Error("create failed");
    await makeArchiveDocument(h.deps)(h.ctx, created.value.id);
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "meta.update", patch: { title: "Nope" } }],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.error.code).toBe("VALIDATION");
  });

  it("caps the ops batch size", async () => {
    const h = makeHarness({ maxOpsPerPatch: 2 });
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [
        { op: "meta.update", patch: { title: "1" } },
        { op: "meta.update", patch: { title: "2" } },
        { op: "meta.update", patch: { title: "3" } },
      ],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    expect(patched.error.code).toBe("VALIDATION");
    expect(patched.error.details?.[0]?.path).toBe("ops");
  });

  it("retries once when a concurrent write wins the read-update race", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const repo = h.store.documents;
    const originalUpdate = repo.updateDraft.bind(repo);
    let intercepts = 0;
    repo.updateDraft = async (...args) => {
      if (intercepts++ === 0) {
        // simulate another writer committing between the service's read and write
        await originalUpdate("ws_a", created.value!.id, 0, {
          draft: draftWith([{ id: "other", kind: "text", props: {} }]),
        }, h.clock.now());
        return "CONFLICT";
      }
      return originalUpdate(...args);
    };
    const patched = await makePatchDocument(h.deps)(h.ctx, created.value.id, {
      baseRev: 0,
      ops: [{ op: "block.insert", index: 0, block: heroBlock }],
    });
    expect(patched.ok).toBe(false);
    if (patched.ok) return;
    // surfaced as a §8 conflict with the *current* server state after refetch
    const err = patched.error as RevConflictError;
    expect(err.code).toBe("CONFLICT");
    expect(err.currentRev).toBe(1);
    expect(err.currentBody).toBeDefined();
  });

  it("keeps the workspace boundary on PATCH", async () => {
    const h = makeHarness();
    const created = await makeCreateDocument(h.deps)(h.ctx, { type: "form", title: "A" });
    if (!created.ok) throw new Error("create failed");
    const foreign = await makePatchDocument(h.deps)(
      makeCtx(h.clock, { workspaceId: "ws_b", actor: { type: "user", id: "u_2" } }),
      created.value.id,
      { baseRev: 0, ops: [{ op: "meta.update", patch: { title: "Hax" } }] },
    );
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe("NOT_FOUND");
  });
});
