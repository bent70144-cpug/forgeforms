// Follow-up #5 (builder-audit §6.6/§14) — slug availability service tests.
// DB-free: the same in-memory CrudDocumentsRepo fake the CRUD tests use.
import { describe, expect, it } from "vitest";
import { createInMemoryCrudDocumentStore } from "../crud-inmemory";
import { isValidSlugFormat, makeCheckSlugAvailable } from "../slug-check";
import { makeCtx, makeDocument, makeDraft } from "./helpers";

type Seed = { id: string; slug: string; workspaceId?: string };

function makeService(seeds: Seed[]) {
  const store = createInMemoryCrudDocumentStore();
  for (const seed of seeds) {
    store.put(
      makeDocument(makeDraft(), {
        id: seed.id,
        slug: seed.slug,
        ...(seed.workspaceId ? { workspaceId: seed.workspaceId } : {}),
      }),
    );
  }
  return makeCheckSlugAvailable({ documents: store.documents });
}

const ctx = makeCtx(); // workspaceId ws_a

describe("checkSlugAvailable (§6 slug unique per workspace, §14 inline suggestion)", () => {
  it("available when the slug is unused in the workspace", async () => {
    const check = makeService([{ id: "doc_1", slug: "my-form" }]);
    const result = await check(ctx, "doc_1", "contact-form");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.available).toBe(true);
      expect("suggestion" in result.value).toBe(false);
    }
  });

  it("available when the slug belongs to the checked document itself (self-exclusion)", async () => {
    const check = makeService([{ id: "doc_1", slug: "my-form" }]);
    const result = await check(ctx, "doc_1", "my-form");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.available).toBe(true);
  });

  it("taken → suggestion is the first free `-2` variant", async () => {
    const check = makeService([
      { id: "doc_1", slug: "other-form" },
      { id: "doc_2", slug: "my-form" },
    ]);
    const result = await check(ctx, "doc_1", "my-form");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.available).toBe(false);
      expect(result.value.suggestion).toBe("my-form-2");
    }
  });

  it("suggestion walks `-3`, … past every collision family member", async () => {
    const check = makeService([
      { id: "doc_1", slug: "other-form" },
      { id: "doc_2", slug: "my-form" },
      { id: "doc_3", slug: "my-form-2" },
      { id: "doc_4", slug: "my-form-3" },
    ]);
    const result = await check(ctx, "doc_1", "my-form");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.available).toBe(false);
      expect(result.value.suggestion).toBe("my-form-4");
    }
  });

  it("suggestion walk ignores the checked document itself", async () => {
    // doc_1 currently owns "my-form-2"; renaming doc_1 to the taken "my-form"
    // suggests "my-form-2", which is doc_1's OWN slug → free for doc_1.
    const check = makeService([
      { id: "doc_1", slug: "my-form-2" },
      { id: "doc_2", slug: "my-form" },
    ]);
    const result = await check(ctx, "doc_1", "my-form");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.available).toBe(false);
      expect(result.value.suggestion).toBe("my-form-2");
    }
  });

  it("slugs of other workspaces never collide (tenant scoping)", async () => {
    const check = makeService([
      { id: "doc_1", slug: "other-form" },
      { id: "doc_ws_b", slug: "my-form", workspaceId: "ws_b" },
    ]);
    const result = await check(ctx, "doc_1", "my-form");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.available).toBe(true);
  });

  it("422 VALIDATION with a `slug` field detail when the format is wrong", async () => {
    const check = makeService([{ id: "doc_1", slug: "my-form" }]);
    for (const bad of ["AB", "ab", "my form", "a".repeat(61), ""]) {
      const result = await check(ctx, "doc_1", bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.details?.[0]?.path).toBe("slug");
      }
    }
  });

  it("404 NOT_FOUND for an unknown document (never leaks other workspaces)", async () => {
    const check = makeService([{ id: "doc_ws_b", slug: "my-form", workspaceId: "ws_b" }]);
    const result = await check(ctx, "doc_missing", "my-form");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("isValidSlugFormat (same §6.6 rules as the panel's client check)", () => {
  it("accepts [a-z0-9-] of length 3–60", () => {
    expect(isValidSlugFormat("abc")).toBe(true);
    expect(isValidSlugFormat("my-form-2")).toBe(true);
    expect(isValidSlugFormat("a".repeat(60))).toBe(true);
  });

  it("rejects uppercase, underscores, whitespace and wrong lengths", () => {
    expect(isValidSlugFormat("My-Form")).toBe(false);
    expect(isValidSlugFormat("my_form")).toBe(false);
    expect(isValidSlugFormat("ab")).toBe(false);
    expect(isValidSlugFormat("a".repeat(61))).toBe(false);
    expect(isValidSlugFormat("")).toBe(false);
  });
});
