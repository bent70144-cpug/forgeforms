// T29 (spec §17) — abuse controls: the abuse-report intake (parse + route) and
// the staff takedown route (key auth + archive/purge effect). Full-stack
// through the real handlers with in-memory stores; the DB never participates.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn() }));

import {
  createInMemoryDocumentStore,
  emptyDocumentBody,
} from "@formforge/core";
import { POST as postAbuseReport } from "@/app/api/public/abuse-report/route";
import { parseAbuseReport } from "@/lib/abuse/parse";
import { POST as postTakedown } from "@/app/api/internal/admin/documents/[id]/takedown/route";
import { isStaffKeyValid } from "@/lib/security/staff";
import { configureDocumentsApi } from "@/lib/api/documents";

const WS = "11111111-2222-3333-4444-555555555555";
const DOC = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ---------------------------------------------------------------------------
// parseAbuseReport (pure)
// ---------------------------------------------------------------------------

describe("parseAbuseReport", () => {
  it("normalizes a valid report (no PII beyond shapes/flags)", () => {
    const parsed = parseAbuseReport({
      documentRef: "  abc-def  ",
      reason: "collects card numbers",
      contact: "victim@example.com",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.documentRef).toBe("abc-def");
    expect(parsed.value.reasonLength).toBe("collects card numbers".length);
    // The email NEVER lands in the record — only the flag survives.
    expect(parsed.value).not.toContain("victim@example.com");
    expect(parsed.value.hasContact).toBe(true);
  });

  it("rejects an empty or oversized documentRef", () => {
    expect(parseAbuseReport({ documentRef: "" }).ok).toBe(false);
    expect(parseAbuseReport({ documentRef: "x".repeat(301) }).ok).toBe(false);
    expect(parseAbuseReport({}).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/public/abuse-report (accepts form + JSON; rate limited)
// ---------------------------------------------------------------------------

describe("POST /api/public/abuse-report", () => {
  it("202s a JSON report and never echoes free text or contact", async () => {
    const res = await postAbuseReport(
      new Request("http://localhost/api/public/abuse-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentRef: DOC, reason: "phishing", contact: "a@b.c" }),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: boolean };
    expect(body.accepted).toBe(true);
    expect(JSON.stringify(body)).not.toContain("phishing");
    expect(JSON.stringify(body)).not.toContain("a@b.c");
  });

  it("accepts the no-JS HTML form post from /report-abuse", async () => {
    const form = new FormData();
    form.set("documentRef", DOC);
    form.set("reason", "collects passwords");
    const res = await postAbuseReport(
      new Request("http://localhost/api/public/abuse-report", {
        method: "POST",
        body: form,
      }),
    );
    expect(res.status).toBe(202);
  });

  it("422s a report without a document reference", async () => {
    const res = await postAbuseReport(
      new Request("http://localhost/api/public/abuse-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "no ref" }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Staff key (constant-time, fail-closed)
// ---------------------------------------------------------------------------

describe("isStaffKeyValid (ADMIN_API_KEY)", () => {
  it("fails closed when the env key is unset or too short", () => {
    const prev = process.env["ADMIN_API_KEY"];
    delete process.env["ADMIN_API_KEY"];
    expect(isStaffKeyValid("anything")).toBe(false);
    expect(isStaffKeyValid(null)).toBe(false);
    process.env["ADMIN_API_KEY"] = "short";
    expect(isStaffKeyValid("short")).toBe(false);
    if (prev !== undefined) process.env["ADMIN_API_KEY"] = prev;
    else delete process.env["ADMIN_API_KEY"];
  });

  it("accepts only the exact env key (length-mismatch short-circuits)", () => {
    process.env["ADMIN_API_KEY"] = "ffkey_" + "y".repeat(48);
    expect(isStaffKeyValid("ffkey_" + "y".repeat(48))).toBe(true);
    expect(isStaffKeyValid("ffkey_" + "y".repeat(47) + "z")).toBe(false);
    expect(isStaffKeyValid("ffkey_" + "y".repeat(48) + " ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/internal/admin/documents/:id/takedown
// ---------------------------------------------------------------------------

describe("POST admin takedown", () => {
  beforeEach(() => {
    process.env["ADMIN_API_KEY"] = "ffkey_" + "z".repeat(48);
  });

  function request(docId: string, withKey: boolean, workspaceId = WS): Request {
    return new Request(`http://localhost/api/internal/admin/documents/${docId}/takedown`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withKey ? { "x-admin-key": process.env["ADMIN_API_KEY"]! } : {}),
      },
      body: JSON.stringify({ workspaceId }),
    });
  }

  async function seedPublishedDocument(docId: string) {
    const store = createInMemoryDocumentStore();
    store.put({
      id: docId,
      workspaceId: WS,
      type: "page",
      title: "Abusive page",
      slug: "abusive-page",
      status: "published",
      rev: 1,
      draft: emptyDocumentBody("page"),
      publishedVersionId: "ver_1",
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.snapshots.upsert({
      documentId: docId,
      versionId: "ver_1",
      rendered: {
        documentId: docId,
        versionId: "ver_1",
        type: "page",
        title: "Abusive page",
        seo: { title: "Abusive page" },
        locale: "en",
        cssVars: {},
        blocks: [],
        endings: [],
        routing: {},
        settings: { progressBar: true, autoAdvance: true, showBranding: true, captcha: false },
      },
      etag: "e1",
      builtAt: new Date(),
    });
    configureDocumentsApi({
      documents: store.documents,
      versions: store.versions,
      snapshots: store.snapshots,
      cdn: { purgeTag: async () => {}, purgeKeys: async () => {} },
      validator: { validate: async () => [] },
      compiler: { compile: () => ({ routing: {}, issues: [] }) },
      assets: { resolve: async () => null },
      publicUrl: { documentUrl: async () => "https://formforge.test/p/abusive-page" },
    });
  }

  it("refuses without a valid staff key (fail closed, even with everything else correct)", async () => {
    const res = await postTakedown(request(DOC, false), { params: Promise.resolve({ id: DOC }) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("403s when ADMIN_API_KEY is unset (env missing → no staff access at all)", async () => {
    const prev = process.env["ADMIN_API_KEY"];
    delete process.env["ADMIN_API_KEY"];
    try {
      const res = await postTakedown(request(DOC, true), { params: Promise.resolve({ id: DOC }) });
      expect(res.status).toBe(403);
    } finally {
      if (prev !== undefined) process.env["ADMIN_API_KEY"] = prev;
    }
  });

  it("archives the document, drops its snapshot and reports the outcome", async () => {
    await seedPublishedDocument(DOC);
    const res = await postTakedown(request(DOC, true), { params: Promise.resolve({ id: DOC }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; takedown: boolean; documentId: string };
    expect(body).toEqual({ documentId: DOC, status: "archived", takedown: true });

    // Repeat → idempotent (takedown: false, cache purged again).
    const res2 = await postTakedown(request(DOC, true), { params: Promise.resolve({ id: DOC }) });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { takedown: boolean };
    expect(body2.takedown).toBe(false);
  });

  it("422s invalid uuid path/workspace ids", async () => {
    const res = await postTakedown(request("not-a-uuid", true), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(422);
    const res2 = await postTakedown(request(DOC, true, "nope"), { params: Promise.resolve({ id: DOC }) });
    expect(res2.status).toBe(422);
  });
});
