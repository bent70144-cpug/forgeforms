// Route handler tests: auth/context, payload validation, PLAN_LIMIT→402
// mapping, success shape. Core is partially mocked (importOriginal keeps
// AppError/DocumentBody real); the provider is never touched.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@formforge/core/ai";

vi.mock("@formforge/core/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@formforge/core/ai")>()),
  runAiDraft: vi.fn(),
  runAiEdit: vi.fn(),
}));

import { runAiDraft, runAiEdit, type DocumentBody } from "@formforge/core/ai";
import { POST as draftPost } from "./route";

const WORKSPACE_HEADERS = { "x-workspace-id": "ws_1" };

function jsonRequest(body: unknown, headers: Record<string, string> = WORKSPACE_HEADERS) {
  return new Request("http://localhost/api/v1/ai/draft", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY: DocumentBody = {
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
  blocks: [{ id: "b1", kind: "short-text", props: { label: "Name" } }],
  endings: [],
  logic: { rules: [] },
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/formforge-test");
  vi.mocked(runAiDraft).mockReset();
  vi.mocked(runAiEdit).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/ai/draft", () => {
  it("401 without a workspace context", async () => {
    const response = await draftPost(jsonRequest({ prompt: "hi" }, {}));
    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  it("422 on a non-JSON body", async () => {
    const response = await draftPost(
      new Request("http://localhost/api/v1/ai/draft", {
        method: "POST",
        headers: WORKSPACE_HEADERS,
        body: "not json",
      }),
    );
    expect(response.status).toBe(422);
  });

  it("422 when prompt is missing or documentType is unknown", async () => {
    const missing = await draftPost(jsonRequest({ documentType: "form" }));
    expect(missing.status).toBe(422);
    const badType = await draftPost(jsonRequest({ prompt: "x", documentType: "deck" }));
    expect(badType.status).toBe(422);
    expect(vi.mocked(runAiDraft)).not.toHaveBeenCalled();
  });

  it("201 with the validated DocumentBody, attempts and quota", async () => {
    vi.mocked(runAiDraft).mockResolvedValue({
      ok: true as const,
      value: {
        body: VALID_BODY,
        attempts: 1,
        quota: { plan: "free", used: 1, limit: 5, period: "2026-11", metric: "ai.draft" },
      },
    });

    const response = await draftPost(
      jsonRequest({ prompt: "  A feedback form  ", documentType: "form" }),
    );
    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      body: DocumentBody;
      attempts: number;
      quota: { used: number };
    };
    expect(json.body.schemaVersion).toBe(1);
    expect(json.attempts).toBe(1);
    expect(json.quota.used).toBe(1);

    const call = vi.mocked(runAiDraft).mock.calls[0];
    expect(call?.[0].workspaceId).toBe("ws_1");
    expect(call?.[2]).toEqual({ prompt: "A feedback form", documentType: "form" }); // trimmed
  });

  it("maps PLAN_LIMIT AppError to 402 with capability=ai (spec §13)", async () => {
    vi.mocked(runAiDraft).mockResolvedValue({
      ok: false as const,
      error: new AppError("PLAN_LIMIT", "Monthly AI quota exhausted for this plan", {
        capability: "ai",
        used: 5,
        limit: 5,
      }),
    });
    const response = await draftPost(jsonRequest({ prompt: "x" }));
    expect(response.status).toBe(402);
    const json = (await response.json()) as {
      error: { code: string; details: { capability: string } };
    };
    expect(json.error.code).toBe("PLAN_LIMIT");
    expect(json.error.details.capability).toBe("ai");
  });

  it("503 when the deployment lacks AI configuration", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await draftPost(jsonRequest({ prompt: "x" }));
    expect(response.status).toBe(503);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("AI_NOT_CONFIGURED");
  });
});
