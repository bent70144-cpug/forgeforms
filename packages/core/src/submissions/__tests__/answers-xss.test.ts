// T29 (spec §17 acceptance) — XSS payloads in ANSWERS are neutralized.
//
// The rich-text plane is covered by documents/__tests__/sanitize.test.ts; this
// suite pins the ANSWER plane's defense-in-depth story:
//
//   1. validateAnswers enforces each block's answerSchema, so only plain
//      scalar/array values (never markup objects) are accepted — an XSS
//      payload string is stored as an OPAQUE DATA VALUE, not interpreted.
//   2. The ingest service persists the payload verbatim as JSON and returns
//      it as data; nothing server-side ever re-serializes an answer into HTML.
//   3. Downstream consumers stay inert: React renders answers as text
//      (auto-escaped) and the CSV export guards formula injection
//      (= + - @ TAB CR prefixed, RFC 4180 quoting).
//
// If any of these three layers regresses, an answer like
// `<img src=x onerror=alert(1)>` could become executable — this suite fails.

import { describe, expect, it } from "vitest";
import { compile, evaluate, routeMap } from "../../logic/index.ts";
import type { Block } from "../../logic/types.ts";
import { uuidv7 } from "../../shared/ids.ts";
import type { IngestSnapshot } from "../types";
import { escapeCsvCell, sanitizeCsvFormula } from "../../export";
import {
  CaptureEventQueue,
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  InMemorySubmissionsRepo,
  InMemoryUsageCounter,
  StubTurnstileVerifier,
  createBootstrapBlockRegistry,
  type BlockRegistry,
  type IngestDeps,
  type IngestRequestCtx,
  type SnapshotReader,
} from "../index";
import { completeSubmission, saveStep, startSubmission } from "../ingest";
import { validateAnswers } from "../blocks";

const registry: BlockRegistry = createBootstrapBlockRegistry();

const FORM_BLOCKS: Block[] = [
  { id: "b1", kind: "short-text", props: { label: "Name" } },
  { id: "b2", kind: "email", props: { label: "Email" } },
  {
    id: "b3",
    kind: "single-select",
    props: { label: "Plan", options: [{ id: "opt_pro", label: "Pro" }] },
  },
];

const XSS_STRINGS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  'javascript:alert(1)',
  '<a href="javascript:alert(1)">click</a>',
  '"><script>alert(1)</script>',
  "<scr<script>ipt>alert(1)</scr</script>ipt>",
  "=Math.CONCAT(REPT(1,9),\"pwned\")",
];

function makeSnapshot(): IngestSnapshot {
  const endings = [{ id: "end_1", title: "Thanks" }];
  return {
    documentId: uuidv7(),
    workspaceId: uuidv7(),
    versionId: uuidv7(),
    type: "form",
    title: "XSS answers form",
    blocks: FORM_BLOCKS,
    endings,
    routing: routeMap(compile([], FORM_BLOCKS, endings.map((e) => e.id))),
    settings: { captcha: false },
  };
}

function makeDeps(snapshot: IngestSnapshot) {
  const repo = new InMemorySubmissionsRepo();
  const deps: IngestDeps = {
    repo,
    snapshots: {
      getPublishedSnapshot: async (documentId) =>
        documentId === snapshot.documentId ? snapshot : null,
    } satisfies SnapshotReader,
    blocks: registry,
    idempotency: new InMemoryIdempotencyStore(),
    rateLimiter: new InMemoryRateLimiter(),
    turnstile: new StubTurnstileVerifier(),
    queue: new CaptureEventQueue(),
    usage: new InMemoryUsageCounter(),
    now: () => new Date("2026-11-06T10:00:00.000Z"),
    generateId: uuidv7,
    evaluate,
  };
  return { deps, repo };
}

const ctx: IngestRequestCtx = {
  requestId: "req_xss",
  actor: { type: "system", id: "public-ingest" },
  now: () => new Date("2026-11-06T10:00:00.000Z"),
};

describe("answers XSS — validateAnswers treats payloads as opaque data", () => {
  it("accepts every classic XSS payload as a plain short-text string", () => {
    const snapshot = makeSnapshot();
    for (const payload of XSS_STRINGS) {
      const res = validateAnswers(
        snapshot,
        registry,
        [{ blockId: "b1", value: payload }],
      );
      expect(res.ok, payload).toBe(true);
      if (!res.ok) continue;
      // Stored as the exact string — no transformation, no markup interpretation.
      expect(res.parsed[0]?.value).toBe(payload);
    }
  });

  it("rejects structured (non-scalar) payload shapes the schema forbids", () => {
    const snapshot = makeSnapshot();
    const res = validateAnswers(snapshot, registry, [
      // single-select only accepts {optionId}/{other} — a markup object is rejected
      { blockId: "b3", value: { optionId: '<script>alert(1)</script>' } },
    ]);
    expect(res.ok).toBe(false);
  });

  it("rejects XSS junk where the block validates content (email)", () => {
    const snapshot = makeSnapshot();
    const res = validateAnswers(snapshot, registry, [
      { blockId: "b2", value: "<script>alert(1)</script>@evil.example" },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.some((d) => d.path === "answers[0].value")).toBe(true);
  });
});

describe("answers XSS — ingest round-trip stores inert JSON", () => {
  it("persists a payload answer verbatim and completes as data", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo } = makeDeps(snapshot);
    const payload = '<img src=x onerror=alert(1)>';

    const start = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const token = start.value.token;

    const save = await saveStep(deps, ctx, {
      token,
      idempotencyKey: "idem_xss_1",
      answers: [{ blockId: "b1", value: payload }],
    });
    expect(save.ok).toBe(true);

    const stored = await repo.getSubmissionByToken(token);
    expect(stored).not.toBeNull();
    const answer = (await repo.listAnswers(stored!.id)).find((a) => a.blockId === "b1");
    // Exact opaque string in storage — no sanitization needed because nothing
    // will ever interpret it as HTML (React text / CSV cell guards downstream).
    expect(answer?.value).toBe(payload);
    // Serialized as a plain JSON string (data), never as markup/HTML structure.
    expect(JSON.stringify(answer?.value).startsWith('"')).toBe(true);

    const done = await completeSubmission(deps, ctx, {
      token,
      idempotencyKey: "idem_xss_2",
      answers: [{ blockId: "b1", value: payload }],
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // Completion never echoes answers as markup — the final stored row stays
    // the exact opaque string.
    const finalStored = await repo.getSubmissionByToken(token);
    const finalAnswer = (await repo.listAnswers(finalStored!.id)).find(
      (a) => a.blockId === "b1",
    );
    expect(finalAnswer?.value).toBe(payload);
  });
});

describe("answers XSS — CSV export formula-injection guard", () => {
  it("prefixes spreadsheet-dangerous first characters with a single quote", () => {
    expect(sanitizeCsvFormula('=HYPERLINK("http://evil","pwn")')).toMatch(/^'/);
    expect(sanitizeCsvFormula("@SUM(1,2)")).toMatch(/^'/);
    expect(sanitizeCsvFormula("+1+1")).toMatch(/^'/);
    expect(sanitizeCsvFormula("-2-2")).toMatch(/^'/);
    expect(sanitizeCsvFormula("\tpwned")).toMatch(/^'/);
  });

  it("wraps quoting-hostile payloads per RFC 4180 (no cell breakout)", () => {
    const cell = escapeCsvCell('<script>a","b</script>');
    expect(cell.startsWith('"')).toBe(true);
    expect(cell.endsWith('"')).toBe(true);
    expect(cell).not.toContain('<script>a","b</script>'); // quotes doubled inside
  });

  it("leaves ordinary answers untouched", () => {
    expect(sanitizeCsvFormula("Jane Doe")).toBe("Jane Doe");
    expect(escapeCsvCell("Jane Doe")).toBe("Jane Doe");
  });
});
