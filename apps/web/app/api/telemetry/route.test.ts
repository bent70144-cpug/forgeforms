// Route-handler tests for POST /api/telemetry (builder audit follow-up #9).
//
// Through-the-real-handler tests: session auth (mocked session reader, same
// seam as the /api/v1 route tests) → rate limit → Zod validation (allowlist +
// closed prop shapes). No DB, no network; pino logs go to stdout and are not
// asserted here (the schema test below pins the payload contract instead).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@formforge/core/identity";

vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: vi.fn(),
}));

import { getCurrentSession } from "@/lib/auth/session";
import {
  TELEMETRY_RATE_LIMIT_PER_MINUTE,
  resetTelemetryRateLimiter,
} from "@/lib/telemetry/rate-limit";
import { POST } from "./route";

const OWNER_SESSION = {
  session: {
    id: "sess-1",
    userId: "user-1",
    tokenHash: "hash",
    expiresAt: new Date("2026-12-31T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  },
  user: { id: "user-1", email: "ada@example.com", name: "Ada", passwordHash: null, emailVerifiedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") },
  workspace: { id: "ws_1", name: "Ada Inc", slug: "ada-inc", plan: "free", stripeCustomerId: null, stripeSubscriptionId: null, createdAt: new Date("2026-01-01T00:00:00Z") },
  role: "owner",
} as AuthenticatedSession;

function post(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/telemetry", {
    method: "POST",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getCurrentSession).mockReset();
  vi.mocked(getCurrentSession).mockResolvedValue(OWNER_SESSION);
  resetTelemetryRateLimiter();
});

describe("POST /api/telemetry — happy path", () => {
  it("204 for a valid §15 batch (no props / ids / counts / statuses / booleans)", async () => {
    const res = await POST(
      post({
        events: [
          { event: "builder_opened", props: {} },
          { event: "block_added", props: { kind: "short-text" } },
          { event: "block_deleted" },
          { event: "block_moved" },
          { event: "undo" },
          { event: "redo" },
          { event: "autosave_ok", props: { opsCount: 4, ms: 82 } },
          { event: "autosave_error", props: { status: "503" } },
          { event: "conflict", props: { resolved: true } },
          { event: "publish_attempt", props: { issues: 2 } },
          { event: "publish_ok" },
          { event: "preview_opened" },
          { event: "template_used", props: { id: "contact-form" } },
          { event: "ai_applied", props: { opsCount: 3 } },
        ],
      }),
    );
    expect(res.status).toBe(204);
  });

  it("403 without a session (telemetry is a browser/authenticated surface)", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const res = await POST(post({ events: [{ event: "builder_opened" }] }));
    expect(res.status).toBe(403);
  });

  it("422 for a malformed JSON body or missing events", async () => {
    const bad = await POST(new Request("http://localhost/api/telemetry", { method: "POST", body: "not json", headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(422);

    const empty = await POST(post({ events: [] }));
    expect(empty.status).toBe(422);

    const noEvents = await POST(post({}));
    expect(noEvents.status).toBe(422);
  });
});

describe("POST /api/telemetry — allowlist enforcement (§15 vocabulary)", () => {
  it("422 for an event name outside the vocabulary", async () => {
    const res = await POST(
      post({ events: [{ event: "keystroke_typed", props: { key: "a" } }] }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("422 for props that do not match the event's named fields", async () => {
    // block_added without {kind} / with content-shaped extras:
    expect(
      (await POST(post({ events: [{ event: "block_added" }] }))).status,
    ).toBe(422);
    expect(
      (
        await POST(
          post({
            events: [
              { event: "block_added", props: { kind: "short-text", label: "What is your name?" } },
            ],
          }),
        )
      ).status,
    ).toBe(422);

    // template_used {id} — an `answer` key is content and must be rejected:
    expect(
      (
        await POST(
          post({
            events: [{ event: "template_used", props: { id: "contact-form", answer: "Ada" } }],
          }),
        )
      ).status,
    ).toBe(422);

    // bare events must not smuggle props:
    expect(
      (await POST(post({ events: [{ event: "publish_ok", props: { label: "x" } }] }))).status,
    ).toBe(422);

    // autosave_ok needs BOTH named fields:
    expect(
      (await POST(post({ events: [{ event: "autosave_ok", props: { opsCount: 1 } }] }))).status,
    ).toBe(422);

    // conflict needs the boolean:
    expect(
      (await POST(post({ events: [{ event: "conflict", props: { resolved: "yes" } }] }))).status,
    ).toBe(422);
  });

  it("422 for over-cap strings and non-token shapes (content-looking payloads)", async () => {
    const longKind = "a".repeat(65);
    expect(
      (await POST(post({ events: [{ event: "block_added", props: { kind: longKind } }] }))).status,
    ).toBe(422);

    expect(
      (
        await POST(
          post({ events: [{ event: "template_used", props: { id: "has spaces in it" } }] }),
        )
      ).status,
    ).toBe(422);

    expect(
      (
        await POST(
          post({ events: [{ event: "autosave_error", props: { status: "free text status!" } }] }),
        )
      ).status,
    ).toBe(422);
  });

  it("422 for batches above the size cap or unknown top-level keys", async () => {
    const events = Array.from({ length: 51 }, () => ({ event: "undo" }));
    expect((await POST(post({ events }))).status).toBe(422);

    expect(
      (await POST(post({ events: [{ event: "undo" }], workspaceId: "ws_9" }))).status,
    ).toBe(422);
  });

  it("422 for an oversized payload (content-length cap)", async () => {
    const req = post({ events: [{ event: "undo" }] }, {
      "content-length": String(64 * 1024 + 1),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});

describe("POST /api/telemetry — per-workspace+user rate limit", () => {
  it("429 + Retry-After after 60 batch-requests in a minute", async () => {
    for (let i = 0; i < TELEMETRY_RATE_LIMIT_PER_MINUTE; i++) {
      const res = await POST(post({ events: [{ event: "undo" }] }));
      expect(res.status).toBe(204);
    }
    const blocked = await POST(post({ events: [{ event: "undo" }] }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("keys per user — a second user still has budget in the same window", async () => {
    for (let i = 0; i < TELEMETRY_RATE_LIMIT_PER_MINUTE; i++) {
      await POST(post({ events: [{ event: "undo" }] }));
    }
    const otherUser = { ...OWNER_SESSION, user: { ...OWNER_SESSION.user, id: "user-2" } };
    vi.mocked(getCurrentSession).mockResolvedValue(otherUser);
    const res = await POST(post({ events: [{ event: "undo" }] }));
    expect(res.status).toBe(204);
  });
});
