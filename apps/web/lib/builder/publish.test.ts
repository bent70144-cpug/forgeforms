// B7 — tests for the publish gate (spec §7.5 draft-vs-published, §8.1
// validation levels + codes, §4 Publish button states, §22.1 endpoint).
// Pure node tests: fixture DocumentBodies + a stubbed fetch; no DOM, no net.
import { describe, expect, it } from "vitest";
import type { DocumentBody } from "../bridge";
import { emptyBody } from "./ops";
import {
  ABUSE_POLICY_NOTE,
  ISSUE_CODES,
  type FetchLike,
  type ValidationIssue,
  blockIdFromDocPath,
  blockingCount,
  collectIssues,
  groupIssues,
  hasUnpublishedChanges,
  mergeIssues,
  publishButtonState,
  publishDocument,
} from "./publish";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal, fully valid form (1 question + 1 ending → no issues). */
function formBody(overrides: Partial<DocumentBody> = {}): DocumentBody {
  return {
    ...emptyBody("form"),
    blocks: [{ id: "q1", kind: "short-text", props: { label: "Your name" } }],
    endings: [{ id: "end1", title: "Thanks!" }],
    ...overrides,
  };
}

function codesOf(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function issue(code: string, blockId: string | null, message = "m", path?: string): ValidationIssue {
  return { code, message, blockId, ...(path !== undefined ? { path } : {}), level: "error" };
}

// ---------------------------------------------------------------------------
// collectIssues — §8.1 codes (schema + client-side supplements)
// ---------------------------------------------------------------------------

describe("collectIssues", () => {
  it("a valid form produces no issues", () => {
    expect(collectIssues(formBody())).toEqual([]);
  });

  it("EMPTY_LABEL: a question with a blank label (schema issue classified)", () => {
    const issues = collectIssues(
      formBody({ blocks: [{ id: "q1", kind: "short-text", props: { label: "" } }] }),
    );
    const labels = issues.filter((issue) => issue.code === ISSUE_CODES.emptyLabel);
    expect(labels).toHaveLength(1); // schema + supplement dedupe to one
    expect(labels[0]?.blockId).toBe("q1");
    expect(labels[0]?.level).toBe("error");
  });

  it("EMPTY_LABEL: a missing label prop on a block whose editor declares one", () => {
    const issues = collectIssues(
      formBody({ blocks: [{ id: "q1", kind: "short-text", props: {} }] }),
    );
    expect(codesOf(issues)).toContain(ISSUE_CODES.emptyLabel);
  });

  it("NO_OPTIONS: a select with fewer than 2 non-empty options", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          {
            id: "s1",
            kind: "single-select",
            props: { label: "Pick", options: [{ id: "a", label: "Only" }] },
          },
        ],
      }),
    );
    const noOptions = issues.filter((issue) => issue.code === ISSUE_CODES.noOptions);
    expect(noOptions).toHaveLength(1);
    expect(noOptions[0]?.blockId).toBe("s1");
  });

  it("DUP_OPTION: duplicate option labels (≥ 2 options, so NO_OPTIONS does not fire)", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          {
            id: "s1",
            kind: "dropdown",
            props: {
              label: "Pick",
              options: [
                { id: "a", label: "Same" },
                { id: "b", label: "Same" },
              ],
            },
          },
        ],
      }),
    );
    expect(codesOf(issues)).toContain(ISSUE_CODES.dupOption);
    expect(codesOf(issues)).not.toContain(ISSUE_CODES.noOptions);
  });

  it("BAD_RANGE: number with min > max", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          { id: "n1", kind: "number", props: { label: "Age", min: 10, max: 5 } },
        ],
      }),
    );
    expect(codesOf(issues)).toContain(ISSUE_CODES.badRange);
  });

  it("FILE_TOO_LARGE: maxSizeMb above the 10 MB plan limit", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          { id: "f1", kind: "file-upload", props: { label: "Upload", maxSizeMb: 25, maxFiles: 1, accept: [] } },
        ],
      }),
    );
    expect(codesOf(issues)).toContain(ISSUE_CODES.fileTooLarge);
  });

  it("NO_QUESTIONS + NO_ENDING: an empty form reports both document-level errors", () => {
    const issues = collectIssues(formBody({ blocks: [], endings: [] }));
    expect(codesOf(issues)).toContain(ISSUE_CODES.noQuestions);
    expect(codesOf(issues)).toContain(ISSUE_CODES.noEnding);
    expect(issues.every((issue) => issue.blockId === null)).toBe(true);
  });

  it("a page/portfolio needs neither questions nor endings", () => {
    const body = { ...emptyBody("page"), blocks: [], endings: [] } as DocumentBody;
    expect(collectIssues(body)).toEqual([]);
  });

  it("BAD_URL: ending redirectUrl with a non-http scheme (client-side supplement)", () => {
    const issues = collectIssues(
      formBody({ endings: [{ id: "end1", title: "Bye", redirectUrl: "javascript:alert(1)" }] }),
    );
    const badUrls = issues.filter((issue) => issue.code === ISSUE_CODES.badUrl);
    expect(badUrls).toHaveLength(1);
    expect(badUrls[0]?.blockId).toBeNull();
    expect(badUrls[0]?.path).toBe("endings[0].redirectUrl");
  });

  it("BAD_URL: unparseable ending redirectUrl is blocked", () => {
    const issues = collectIssues(
      formBody({ endings: [{ id: "end1", title: "Bye", redirectUrl: "not a url at all" }] }),
    );
    expect(codesOf(issues)).toContain(ISSUE_CODES.badUrl);
  });

  it("BAD_URL: button href with a script scheme", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          { id: "b1", kind: "short-text", props: { label: "Q" } },
          { id: "cta", kind: "button", props: { label: "Go", href: "javascript:alert(1)" } },
        ],
      }),
    );
    const badUrls = issues.filter((issue) => issue.code === ISSUE_CODES.badUrl);
    expect(badUrls).toHaveLength(1);
    expect(badUrls[0]?.blockId).toBe("cta");
  });

  it("BAD_EMAIL: invalid notifyEmails entry (schema issue classified + deduped)", () => {
    const body = formBody();
    body.settings.notifyEmails = ["not-an-email"];
    const issues = collectIssues(body);
    const badEmails = issues.filter((issue) => issue.code === ISSUE_CODES.badEmail);
    expect(badEmails).toHaveLength(1);
    expect(badEmails[0]?.path).toBe("settings.notifyEmails[0]");
  });

  it("SENSITIVE_FIELD: password-ish labels warn without blocking (§8.1)", () => {
    const issues = collectIssues(
      formBody({ blocks: [{ id: "q1", kind: "short-text", props: { label: "Your password" } }] }),
    );
    const warnings = issues.filter((issue) => issue.code === ISSUE_CODES.sensitiveField);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe("warning");
    expect(warnings[0]?.blockId).toBe("q1");
    expect(blockingCount(issues)).toBe(0);
  });

  it("LOGIC_DANGLING: goto target that matches no block (core logic linter)", () => {
    const issues = collectIssues(
      formBody({
        logic: {
          rules: [
            { id: "r1", scope: "q1", when: [], then: [{ type: "goto", target: "nope" }], isFallback: false },
          ],
        },
      }),
    );
    const dangling = issues.filter((issue) => issue.code === ISSUE_CODES.logicDangling);
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.blockId).toBe("q1");
    expect(dangling[0]?.message).toContain("r1");
  });

  it("LOGIC_CYCLE: two fallback gotos looping with no exit (core logic linter)", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          { id: "b1", kind: "short-text", props: { label: "One" } },
          { id: "b2", kind: "short-text", props: { label: "Two" } },
        ],
        logic: {
          rules: [
            { id: "r1", scope: "b1", when: [], then: [{ type: "goto", target: "b2" }], isFallback: true },
            { id: "r2", scope: "b2", when: [], then: [{ type: "goto", target: "b1" }], isFallback: true },
          ],
        },
      }),
    );
    expect(codesOf(issues)).toContain(ISSUE_CODES.logicCycle);
  });

  it("issues inside layout children carry the container block's id (§8.1 block level)", () => {
    const issues = collectIssues(
      formBody({
        blocks: [
          {
            id: "wrap",
            kind: "section",
            props: {},
            children: [{ id: "q2", kind: "email", props: { label: "" } }],
          },
        ],
      }),
    );
    const labels = issues.filter((issue) => issue.code === ISSUE_CODES.emptyLabel);
    expect(labels[0]?.blockId).toBe("q2");
  });

  it("exposes the abuse-policy note constant for warning UI (§8.1)", () => {
    expect(ABUSE_POLICY_NOTE).toContain("card numbers");
  });
});

// ---------------------------------------------------------------------------
// blockIdFromDocPath
// ---------------------------------------------------------------------------

describe("blockIdFromDocPath", () => {
  const body = formBody({
    blocks: [
      { id: "q1", kind: "short-text", props: { label: "One" } },
      {
        id: "wrap",
        kind: "section",
        props: {},
        children: [{ id: "q2", kind: "email", props: { label: "Two" } }],
      },
    ],
  });

  it("resolves top-level and nested indexes to block ids", () => {
    expect(blockIdFromDocPath("blocks[0].props.label", body.blocks)).toBe("q1");
    expect(blockIdFromDocPath("blocks[1].children[0].props.label", body.blocks)).toBe("q2");
  });

  it("returns null for non-block paths and out-of-range indexes", () => {
    expect(blockIdFromDocPath("settings.locale", body.blocks)).toBeNull();
    expect(blockIdFromDocPath("blocks[9].props.label", body.blocks)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// groupIssues
// ---------------------------------------------------------------------------

describe("groupIssues", () => {
  it("puts the document-level group first, then block groups in first-appearance order", () => {
    const groups = groupIssues([
      issue(ISSUE_CODES.noEnding, null),
      issue(ISSUE_CODES.emptyLabel, "b2"),
      issue(ISSUE_CODES.badUrl, null),
      issue(ISSUE_CODES.noOptions, "b1"),
      issue(ISSUE_CODES.dupOption, "b1"),
    ]);
    expect(groups.map((group) => group.blockId)).toEqual([null, "b2", "b1"]);
    expect(groups[0]?.label).toBe("Document");
    expect(groups[0]?.issues).toHaveLength(2);
    expect(groups[2]?.issues).toHaveLength(2);
  });

  it("labels blocks via labelFor with a Block <id> fallback", () => {
    const groups = groupIssues([issue(ISSUE_CODES.emptyLabel, "b1")], (id) =>
      id === "b1" ? "Your name" : undefined,
    );
    expect(groups[0]?.label).toBe("Your name");
    expect(groupIssues([issue(ISSUE_CODES.emptyLabel, "zz")])[0]?.label).toBe("Block zz");
  });

  it("returns [] for no issues", () => {
    expect(groupIssues([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeIssues
// ---------------------------------------------------------------------------

describe("mergeIssues", () => {
  it("appends server issues, dropping exact duplicates", () => {
    const local = [issue(ISSUE_CODES.emptyLabel, "q1", "This question has no label.", "blocks[0].props.label")];
    const server = [
      issue(ISSUE_CODES.emptyLabel, "q1", "This question has no label.", "blocks[0].props.label"),
      issue(ISSUE_CODES.server, null, "Draft failed validation", "settings"),
    ];
    const merged = mergeIssues(local, server);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.code).toBe(ISSUE_CODES.server);
  });
});

// ---------------------------------------------------------------------------
// publishButtonState + hasUnpublishedChanges (§4 / §7.5)
// ---------------------------------------------------------------------------

describe("publishButtonState", () => {
  const noIssues: ValidationIssue[] = [];
  const withBlocking = [issue(ISSUE_CODES.emptyLabel, "q1")];
  const withWarning: ValidationIssue[] = [
    { code: ISSUE_CODES.sensitiveField, message: "m", blockId: "q1", level: "warning" },
  ];

  it("publishing wins over everything", () => {
    expect(
      publishButtonState({ docStatus: "draft", save: "dirty", issues: withBlocking, publishing: true }),
    ).toBe("publishing");
  });

  it("blocking issues → fix-issues (even when already published)", () => {
    expect(publishButtonState({ docStatus: "draft", save: "saved", issues: withBlocking, publishing: false })).toBe(
      "fix-issues",
    );
    expect(publishButtonState({ docStatus: "published", save: "saved", issues: withBlocking, publishing: false })).toBe(
      "fix-issues",
    );
  });

  it("published + no pending changes → published ✓", () => {
    expect(publishButtonState({ docStatus: "published", save: "saved", issues: noIssues, publishing: false })).toBe(
      "published",
    );
    expect(publishButtonState({ docStatus: "published", save: "idle", issues: noIssues, publishing: false })).toBe(
      "published",
    );
  });

  it("published + pending changes (§7.5 draft differs) → back to Publish", () => {
    for (const save of ["dirty", "saving", "offline", "error", "conflict"] as const) {
      expect(publishButtonState({ docStatus: "published", save, issues: noIssues, publishing: false })).toBe("publish");
    }
  });

  it("draft → Publish", () => {
    expect(publishButtonState({ docStatus: "draft", save: "saved", issues: noIssues, publishing: false })).toBe(
      "publish",
    );
  });

  it("warnings never flip the button to fix-issues (§8.1 non-blocking)", () => {
    expect(publishButtonState({ docStatus: "published", save: "saved", issues: withWarning, publishing: false })).toBe(
      "published",
    );
  });
});

describe("hasUnpublishedChanges", () => {
  it("is true for every pending save state (§7.5)", () => {
    for (const save of ["dirty", "saving", "offline", "error", "conflict"] as const) {
      expect(hasUnpublishedChanges(save, [])).toBe(true);
    }
  });

  it("is false for clean saves without issues", () => {
    expect(hasUnpublishedChanges("saved", [])).toBe(false);
    expect(hasUnpublishedChanges("idle", [])).toBe(false);
  });

  it("is true when any issues exist, even on a clean save", () => {
    expect(hasUnpublishedChanges("saved", [issue(ISSUE_CODES.emptyLabel, "q1")])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// publishDocument (§22.1 wire contract)
// ---------------------------------------------------------------------------

function fetchStub(status: number, body: unknown) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fn: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { fn, calls };
}

describe("publishDocument", () => {
  it("POSTs { expectedRev } to /api/v1/documents/:id/publish with transport headers", async () => {
    const { fn, calls } = fetchStub(200, { url: "/p/slug", version: 2 });
    const result = await publishDocument("doc1", 4, fn);
    expect(calls[0]?.input).toBe("/api/v1/documents/doc1/publish");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ expectedRev: 4 });
    expect((calls[0]?.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(result).toEqual({ ok: true, url: "/p/slug", publishedRev: 2, publishedAt: undefined });
  });

  it("maps the §22.1 200 shape { publishedRev, publishedAt, url }", async () => {
    const { fn } = fetchStub(200, { publishedRev: 9, publishedAt: "2025-01-01T00:00:00Z", url: "/p/x" });
    const result = await publishDocument("doc1", 8, fn);
    expect(result).toEqual({
      ok: true,
      url: "/p/x",
      publishedRev: 9,
      publishedAt: "2025-01-01T00:00:00Z",
    });
  });

  it("maps 409 to reason conflict (caller flushes pending ops and retries)", async () => {
    const { fn } = fetchStub(409, { error: { code: "CONFLICT", message: "stale" } });
    const result = await publishDocument("doc1", 1, fn);
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("maps 422 { issues } (§22.1 shape) to validation issues", async () => {
    const { fn } = fetchStub(422, {
      issues: [
        { code: "EMPTY_LABEL", message: "no label", blockId: "q1" },
        { message: "logic broke", path: "logic.rules.r1" },
      ],
    });
    const result = await publishDocument("doc1", 1, fn);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "validation") return;
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({ code: "EMPTY_LABEL", blockId: "q1", level: "error" });
    expect(result.issues[1]).toMatchObject({ code: ISSUE_CODES.server, blockId: null, path: "logic.rules.r1" });
  });

  it("maps 422 { error: { details } } (§4 envelope the current API answers with)", async () => {
    const { fn } = fetchStub(422, {
      error: {
        code: "VALIDATION",
        message: "Draft failed validation",
        details: [{ path: "blocks[0].props.label", message: "Too small" }],
      },
    });
    const result = await publishDocument("doc1", 1, fn);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "validation") return;
    expect(result.issues[0]).toMatchObject({ code: ISSUE_CODES.server, message: "Too small", blockId: null });
  });

  it("maps other failures to reason error with the server message", async () => {
    const { fn } = fetchStub(500, { error: { code: "INTERNAL", message: "boom" } });
    const result = await publishDocument("doc1", 1, fn);
    expect(result).toEqual({ ok: false, reason: "error", message: "boom" });
  });

  // §14 plan-limit answers (follow-up #8): 402/403 are NOT generic errors —
  // the caller surfaces an inline plan-limit explanation in the shell notice.
  it("maps 402 PLAN_LIMIT to reason plan-limit with the §13 capability", async () => {
    const { fn } = fetchStub(402, {
      error: {
        code: "PLAN_LIMIT",
        message: "Plan limit reached for \"customRedirect\" — upgrade to pro.",
        details: [
          { path: "capability", message: "customRedirect" },
          { path: "requiredPlan", message: "pro" },
        ],
      },
    });
    const result = await publishDocument("doc1", 1, fn);
    expect(result).toEqual({
      ok: false,
      reason: "plan-limit",
      status: 402,
      message: "Plan limit reached for \"customRedirect\" — upgrade to pro.",
      capability: "customRedirect",
    });
  });

  it("maps 403 FORBIDDEN to reason plan-limit with null capability", async () => {
    const { fn } = fetchStub(403, { error: { code: "FORBIDDEN", message: "nope" } });
    const result = await publishDocument("doc1", 1, fn);
    expect(result).toEqual({
      ok: false,
      reason: "plan-limit",
      status: 403,
      message: "nope",
      capability: null,
    });
  });

  it("network failures become a friendly error result (never throw)", async () => {
    const fn: FetchLike = async () => {
      throw new Error("offline");
    };
    const result = await publishDocument("doc1", 1, fn);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "error") return;
    expect(result.message).toContain("Network error");
  });
});
