// Edit route tests: document validation against DocumentBody, proposal
// shape (summary/ops/diff), PLAN_LIMIT→402. Core is partially mocked; the
// provider is never touched.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@formforge/core/ai";

vi.mock("@formforge/core/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@formforge/core/ai")>()),
  runAiEdit: vi.fn(),
}));

import { runAiEdit, type DocumentBody } from "@formforge/core/ai";
import { POST as editPost } from "./route";

const WORKSPACE_HEADERS = { "x-workspace-id": "ws_1" };

const DOCUMENT: DocumentBody = {
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

function jsonRequest(body: unknown, headers: Record<string, string> = WORKSPACE_HEADERS) {
  return new Request("http://localhost/api/v1/ai/edit", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/formforge-test");
  vi.mocked(runAiEdit).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/ai/edit", () => {
  it("401 without a workspace context", async () => {
    const response = await editPost(
      jsonRequest({ instruction: "x", document: DOCUMENT }, {}),
    );
    expect(response.status).toBe(401);
  });

  it("422 when instruction or document is missing", async () => {
    const noInstruction = await editPost(jsonRequest({ document: DOCUMENT }));
    expect(noInstruction.status).toBe(422);
    const noDocument = await editPost(jsonRequest({ instruction: "x" }));
    expect(noDocument.status).toBe(422);
    expect(vi.mocked(runAiEdit)).not.toHaveBeenCalled();
  });

  it("422 when document fails DocumentBody validation", async () => {
    const response = await editPost(
      jsonRequest({ instruction: "x", document: { schemaVersion: 3 } }),
    );
    expect(response.status).toBe(422);
    const json = (await response.json()) as {
      error: { code: string; details: Array<{ path: string }> };
    };
    expect(json.error.code).toBe("VALIDATION");
    expect(json.error.details.length).toBeGreaterThan(0);
  });

  it("201 returns summary + ops + reviewable diff (never applies anything)", async () => {
    vi.mocked(runAiEdit).mockResolvedValue({
      ok: true as const,
      value: {
        summary: "Relabel the name question",
        ops: [{ type: "block.update", id: "b1", props: { label: "Full name" } }],
        diff: ['Update short-text "b1" props (label)'],
        attempts: 1,
        quota: { plan: "free", used: 1, limit: 5, period: "2026-11", metric: "ai.edit" },
      },
    });
    const response = await editPost(
      jsonRequest({ instruction: "Relabel the name question", document: DOCUMENT }),
    );
    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      summary: string;
      ops: Array<{ type: string }>;
      diff: string[];
    };
    expect(json.ops[0]?.type).toBe("block.update");
    expect(json.diff[0]).toContain("Update short-text");
    expect(json.summary).toContain("Relabel");

    const call = vi.mocked(runAiEdit).mock.calls[0];
    expect(call?.[0].workspaceId).toBe("ws_1");
    expect(call?.[2].document).toEqual(DOCUMENT);
  });

  it("maps PLAN_LIMIT to 402 with capability=ai", async () => {
    vi.mocked(runAiEdit).mockResolvedValue({
      ok: false as const,
      error: new AppError("PLAN_LIMIT", "Monthly AI quota exhausted for this plan", {
        capability: "ai",
      }),
    });
    const response = await editPost(
      jsonRequest({ instruction: "x", document: DOCUMENT }),
    );
    expect(response.status).toBe(402);
    const json = (await response.json()) as { error: { details: { capability: string } } };
    expect(json.error.details.capability).toBe("ai");
  });
});
