// Quota tests: the can() gate and the monthly counter run BEFORE any
// provider call; PLAN_LIMIT carries capability=ai and HTTP 402.
import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/errors.ts";
import { err, ok } from "../../shared/result.ts";;
import type { DocumentBody } from "../types";
import { createRequestCtx, runAiDraft, runAiEdit } from "../index";
import { checkAiQuota, planLimitFor, usagePeriod, AI_DRAFT_METRIC, AI_EDIT_METRIC } from "../quota";
import { FakeProvider, FakeUsageRepo, VALID_DRAFT_TEXT } from "./helpers";

const NOW = new Date("2026-11-05T20:10:03Z");

function makeDeps(overrides?: {
  can?: (workspaceId: string, capability: string) => Promise<boolean>;
  plan?: "free" | "pro" | "business";
  events?: string[];
}) {
  const usage = new FakeUsageRepo(overrides?.events);
  return {
    usage,
    can: overrides?.can ?? (async () => true),
    getPlan: async () => overrides?.plan ?? ("free" as const),
    provider: new FakeProvider(),
  };
}

describe("usagePeriod", () => {
  it("formats the UTC billing month as YYYY-MM", () => {
    expect(usagePeriod(NOW)).toBe("2026-11");
    expect(usagePeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(usagePeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });
});

describe("plan limits (issue #27: X drafts/month per plan, default free=5)", () => {
  it("free plan defaults to 5/month", () => {
    expect(planLimitFor("free")).toBe(5);
  });
  it("paid plans have higher limits", () => {
    expect(planLimitFor("pro")).toBeGreaterThan(5);
    expect(planLimitFor("business")).toBeGreaterThan(planLimitFor("pro"));
  });
});

describe("checkAiQuota", () => {
  it("entitlement refused → PLAN_LIMIT 402 with capability=ai, counter untouched", async () => {
    const deps = makeDeps({ can: async () => false });
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const result = await checkAiQuota(ctx, deps, AI_DRAFT_METRIC);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLAN_LIMIT");
    expect(result.error.status).toBe(402);
    expect(result.error.details).toEqual(expect.arrayContaining([
      { path: "capability", message: "ai" },
      { path: "requiredPlan", message: "pro" },
    ]));
    expect(deps.usage.counts.size).toBe(0); // no counter reads/writes on refusal
  });

  it("counter at the limit → PLAN_LIMIT with used/limit/period details", async () => {
    const deps = makeDeps();
    deps.usage.counts.set("ws_1|2026-11|ai.draft", 5);
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const result = await checkAiQuota(ctx, deps, AI_DRAFT_METRIC);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLAN_LIMIT");
    expect(result.error.status).toBe(402);
    expect(result.error.details).toEqual(expect.arrayContaining([
      { path: "capability", message: "ai" },
      { path: "requiredPlan", message: "pro" },
      { path: "used", message: "5" },
      { path: "limit", message: "5" },
      { path: "metric", message: "ai.draft" },
      { path: "period", message: expect.any(String) },
    ]));
  });

  it("under the limit → ok with quota state", async () => {
    const deps = makeDeps();
    deps.usage.counts.set("ws_1|2026-11|ai.draft", 4);
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const result = await checkAiQuota(ctx, deps, AI_DRAFT_METRIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ plan: "free", used: 4, limit: 5, period: "2026-11" });
  });

  it("edit drafts are counted separately from drafts", async () => {
    const deps = makeDeps();
    deps.usage.counts.set("ws_1|2026-11|ai.draft", 99); // drafts exhausted...
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const edit = await checkAiQuota(ctx, deps, AI_EDIT_METRIC);
    expect(edit.ok).toBe(true); // ...edits are not
  });
});

describe("runAiDraft / runAiEdit ordering", () => {
  it("quota exhausted → PLAN_LIMIT before the provider is called", async () => {
    const events: string[] = [];
    const deps = makeDeps({ events });
    deps.usage.counts.set("ws_1|2026-11|ai.draft", 5);
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const result = await runAiDraft(ctx, deps, {
      prompt: "A form",
      documentType: "form",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLAN_LIMIT");
    expect(deps.provider.calls).toHaveLength(0); // provider never invoked
    expect(events).not.toContain("provider");
    expect(events).not.toContain("increment"); // and nothing was persisted
  });

  it("success path: provider called first, usage persisted after", async () => {
    const events: string[] = [];
    const deps = makeDeps({ events });
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const result = await runAiDraft(ctx, { ...deps, provider: {
      complete: async () => {
        events.push("provider");
        return ok(VALID_DRAFT_TEXT);
      },
    } }, {
      prompt: "A two-question form",
      documentType: "form",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(events).toEqual(["provider", "increment"]); // quota gate → provider → persist
    expect(result.value.quota).toMatchObject({ used: 1, limit: 5, metric: "ai.draft" });
    expect(result.value.body.type).toBe("form");
  });

  it("edit flow returns ops diff and increments the ai.edit metric", async () => {
    const deps = makeDeps();
    deps.provider = new FakeProvider(
      JSON.stringify({
        summary: "Relabel name",
        ops: [{ type: "block.update", id: "b1", props: { label: "Full name" } }],
      }),
    );
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const document: DocumentBody = {
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
      blocks: [{ id: "b1", kind: "short-text", props: { label: "Your name" } }],
      endings: [],
      logic: { rules: [] },
    };
    const result = await runAiEdit(ctx, deps, {
      instruction: "Relabel the name question",
      document,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diff[0]).toContain('Update short-text "b1"');
    expect(result.value.quota.metric).toBe("ai.edit");
    expect(result.value.quota.used).toBe(1);
  });

  it("provider failure does not burn quota (usage persisted on success only)", async () => {
    const events: string[] = [];
    const deps = makeDeps({ events });
    const ctx = createRequestCtx({ workspaceId: "ws_1", now: () => NOW });
    const result = await runAiDraft(
      ctx,
      { ...deps, provider: {
        complete: async () => {
          events.push("provider");
          return err(new AppError("AI_PROVIDER_ERROR", "down"));
        },
      } },
      { prompt: "x", documentType: "form" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    }
    expect(events).toEqual(["provider"]); // provider attempted...
    expect(deps.usage.counts.size).toBe(0); // ...but nothing persisted
  });
});
