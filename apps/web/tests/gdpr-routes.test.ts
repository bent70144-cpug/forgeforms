// T29 (spec §17 GDPR) — route-handler tests for the export / workspace
// deletion / account deletion flows. Full-stack through the real handlers:
// session auth (mocked reader) → container (in-memory gdpr stores) → core
// services. The DB never participates (no DATABASE_URL in unit tests).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn() }));

import { createInMemoryGdprStores } from "@formforge/core/gdpr";
import type { AuthenticatedSession } from "@formforge/core/identity";
import { getCurrentSession } from "@/lib/auth/session";
import { configureGdprStores } from "@/lib/gdpr/container";
import { GET as exportRoute } from "@/app/api/v1/workspace/export/route";
import { DELETE as deleteWorkspaceRoute } from "@/app/api/v1/workspace/delete/route";
import { DELETE as deleteAccountRoute } from "@/app/api/v1/account/delete/route";

const WS = "11111111-2222-3333-4444-555555555555";
const USER = "99999999-8888-7777-6666-555555555555";
const OTHER_WS = "12121212-2222-3333-4444-555555555555";

function sessionFor(role: "owner" | "editor" | "viewer" = "owner"): AuthenticatedSession {
  return {
    session: {
      id: "sess-1",
      userId: USER,
      tokenHash: "hash",
      expiresAt: new Date("2026-12-31T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    user: { id: USER, email: "ada@example.com", name: "Ada", passwordHash: null, emailVerifiedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") },
    workspace: {
      id: WS, name: "Ada Inc", slug: "ada-inc", plan: "free",
      stripeCustomerId: null, stripeSubscriptionId: null, createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    role,
  } as AuthenticatedSession;
}

function seedState() {
  // The gdpr index re-exports only the stores factory — grab a fresh state
  // (type: InMemoryGdprState) off a throwaway stores instance, then seed it.
  return seedInto(createState());
}

function createState(): ReturnType<typeof createInMemoryGdprStores>["state"] {
  return createInMemoryGdprStores().state;
}

function seedInto(state: ReturnType<typeof createInMemoryGdprStores>["state"]) {
  state.workspaces.set(WS, { id: WS, name: "Ada Inc", slug: "ada-inc", createdAt: null, deletedAt: null });
  state.workspaces.set(OTHER_WS, { id: OTHER_WS, name: "Other", slug: "other", createdAt: null, deletedAt: null });
  state.users.set(USER, { id: USER, email: "ada@example.com", createdAt: null });
  state.memberships.set(WS, [{ userId: USER, role: "owner", createdAt: null }]);
  state.memberships.set(OTHER_WS, [{ userId: USER, role: "owner", createdAt: null }]);
  state.documents.set(WS, [
    { id: "doc_1", type: "form", title: "Feedback", slug: "feedback", status: "published", draft: {}, createdAt: null, updatedAt: null },
  ]);
  state.submissions.set(WS, [
    {
      id: "sub_1", workspaceId: WS, documentId: "doc_1", status: "completed",
      startedAt: null, completedAt: null, variables: {}, hidden: {}, meta: {},
      answers: [{ blockId: "q1", value: "hello" }],
    },
  ]);
  // Credential material that must NEVER appear in the export:
  state.webhookEndpoints.set(WS, [
    { id: "wh_1", documentId: null, url: "https://hooks.example", events: [], enabled: true, createdAt: null, secret: "whsec_TOPSECRET" },
  ]);
  state.apiTokens.set(WS, [
    { id: "tok_1", name: "ci", scopes: [], lastUsedAt: null, createdAt: null, tokenHash: "HASHEDTOKEN" },
  ]);
  return state;
}
function wire(state = seedState()) {
  const stores = createInMemoryGdprStores(state);
  configureGdprStores({ export: stores.exports, workspaces: stores.workspaces, accounts: stores.accounts });
  return state;
}

beforeEach(() => {
  vi.mocked(getCurrentSession).mockReset();
  vi.mocked(getCurrentSession).mockResolvedValue(sessionFor("owner"));
});

describe("GET /api/v1/workspace/export", () => {
  it("200s the full archive as a JSON attachment, session-only", async () => {
    const state = wire();
    const res = await exportRoute(new Request("http://localhost/api/v1/workspace/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as {
      format: string; workspace: { id: string };
      submissions: Array<{ id: string; answers: Array<{ blockId: string; value: unknown }> }>;
    };
    expect(body.format).toBe("formforge.workspace-export.v1");
    expect(body.workspace.id).toBe(WS);
    expect(body.submissions[0]?.answers).toEqual([{ blockId: "q1", value: "hello" }]);

    // spec §17: credentials never leave the store — even when the fake carries them.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("TOPSECRET");
    expect(raw).not.toContain("HASHEDTOKEN");
    expect(state.submissions.get(WS)?.length).toBe(1); // export deletes nothing
  });

  it("403s without a session (no cookie → no archive)", async () => {
    wire();
    vi.mocked(getCurrentSession).mockRejectedValue(new Error("no session"));
    const res = await exportRoute(new Request("http://localhost/api/v1/workspace/export"));
    expect(res.status).toBe(403);
  });

  it("404s when the session workspace is unknown (wrong workspace id)", async () => {
    const state = seedState();
    state.workspaces.delete(WS);
    wire(state);
    const res = await exportRoute(new Request("http://localhost/api/v1/workspace/export"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/workspace/delete (phase 1: schedule + grace)", () => {
  it("marks the workspace deleted and is idempotent (first deletedAt wins)", async () => {
    const state = wire();
    const res = await deleteWorkspaceRoute(new Request("http://localhost/api/v1/workspace/delete", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scheduled: boolean; deletedAt: string };
    expect(body.scheduled).toBe(true);
    const firstDeletedAt = body.deletedAt;
    expect(state.workspaces.get(WS)?.deletedAt).not.toBeNull();

    const res2 = await deleteWorkspaceRoute(new Request("http://localhost/api/v1/workspace/delete", { method: "DELETE" }));
    const body2 = (await res2.json()) as { deletedAt: string };
    expect(body2.deletedAt).toBe(firstDeletedAt);

    // Nothing is purged in phase 1 — data survives the grace window intact.
    expect(state.submissions.get(WS)?.length).toBe(1);
    expect(state.documents.get(WS)?.length).toBe(1);
  });

  it("forbids non-owner roles (viewer/editor cannot delete the tenant)", async () => {
    wire();
    vi.mocked(getCurrentSession).mockResolvedValue(sessionFor("viewer"));
    const res = await deleteWorkspaceRoute(new Request("http://localhost/api/v1/workspace/delete", { method: "DELETE" }));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/account/delete", () => {
  it("removes the user, sessions, tokens, memberships and schedules sole-owned workspaces", async () => {
    const state = wire();
    const res = await deleteAccountRoute(new Request("http://localhost/api/v1/account/delete", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string; sessionsDeleted: number; membershipsDeleted: number;
      workspacesScheduled: string[]; workspacesKept: string[];
    };
    expect(body.userId).toBe(USER);
    expect(body.sessionsDeleted).toBeGreaterThanOrEqual(0);
    expect(body.membershipsDeleted).toBe(2);
    // Both seeded workspaces are sole-owned → both scheduled for grace deletion.
    expect(body.workspacesScheduled.sort()).toEqual([OTHER_WS, WS].sort());
    expect(state.users.has(USER)).toBe(false);
    expect(state.memberships.has(WS)).toBe(false);
    // Scheduled ≠ purged — the hard purge runs after the grace window (job).
    expect(state.workspaces.get(WS)).toBeDefined();
    expect(state.workspaces.get(WS)?.deletedAt).not.toBeNull();
  });

  it("keeps co-owned workspaces (the user just leaves them)", async () => {
    const state = seedState();
    state.memberships.set(OTHER_WS, [
      { userId: USER, role: "owner", createdAt: null },
      { userId: "88888888-8888-8888-8888-888888888888", role: "owner", createdAt: null },
    ]);
    wire(state);
    const res = await deleteAccountRoute(new Request("http://localhost/api/v1/account/delete", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspacesKept: string[]; workspacesScheduled: string[] };
    expect(body.workspacesKept).toEqual([OTHER_WS]);
    expect(body.workspacesScheduled).toEqual([WS]);
  });

  it("403s without a session", async () => {
    wire();
    vi.mocked(getCurrentSession).mockRejectedValue(new Error("no session"));
    const res = await deleteAccountRoute(new Request("http://localhost/api/v1/account/delete", { method: "DELETE" }));
    expect(res.status).toBe(403);
  });
});
