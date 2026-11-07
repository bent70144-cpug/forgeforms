// DocumentTransport — the builder's seam to the documents API (spec §11 + §22.1).
//
// - ApiTransport talks to `PATCH /api/v1/documents/:id` with `{ baseRev, ops }`
//   and maps `409 CONFLICT` to ConflictError carrying the server's current rev
//   AND body (`409 { rev, body }`, spec §22.1) so the autosave controller can
//   rebase without a refetch round-trip.
// - `422 { opIndex, code, message }` (spec §22.1) maps to OpRejectedError so
//   the autosave controller can roll back exactly one op (spec §14). The
//   current server still answers with the §4 envelope (index buried in
//   `error.details[].path` as `"ops[3].id"`) — both shapes are parsed.
// - Expired/absent session credentials map to UnauthenticatedError so the
//   autosave controller can park the queue and prompt for re-login (§7.1
//   follow-up #3). Both wire shapes are recognized: a plain HTTP 401, and
//   this app's §4 "Authentication required" FORBIDDEN (403) — the §4
//   vocabulary has no 401, so the server answers session-less requests with
//   403 (see app/api/v1/_lib/auth.ts). A scope-missing FORBIDDEN is NOT
//   re-authable and stays a plain TransportError.
// - MockTransport is an in-memory store with simulated latency and a manual
//   `bumpRev` hook (simulating a concurrent writer) used by the dev toggle and
//   by the autosave tests.
//
// INTEGRATION-DEBT: awaiting T07 (documents CRUD). The envelope/patch payload
// shapes follow spec §8+§11; ApiTransport tolerates both a raw envelope and a
// `{ document: … }` wrapper for GET until the server contract is pinned.

import type { DocumentBody, DocumentEnvelope, DocumentStatus } from "../bridge";
import type { EditableDoc, Op } from "./ops";
import { applyOps } from "./ops";

export type PatchResult = { rev: number; body?: DocumentBody };

export interface DocumentTransport {
  load(docId: string): Promise<DocumentEnvelope>;
  patch(docId: string, baseRev: number, ops: readonly Op[]): Promise<PatchResult>;
  publish?(docId: string): Promise<{ status: DocumentStatus }>;
}

export class TransportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/** `409 CONFLICT` — `baseRev` was stale; carries the server's current state. */
export class ConflictError extends TransportError {
  constructor(
    public readonly rev: number,
    message = "Document was modified by someone else",
    public readonly body?: DocumentBody,
  ) {
    super("CONFLICT", message, 409, { rev });
    this.name = "ConflictError";
  }
}

/**
 * Expired/absent credentials (§7.1 follow-up #3) — the autosave controller
 * parks the queue and raises the re-auth prompt instead of retrying. Raised
 * for a plain HTTP 401 and for this app's §4 "Authentication required"
 * FORBIDDEN (403); scope/permission 403s stay plain TransportErrors.
 */
export class UnauthenticatedError extends TransportError {
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(code, message, status, details);
    this.name = "UnauthenticatedError";
  }
}

/**
 * `422 VALIDATION` — the server rejected exactly one op of the batch
 * (spec §22.1 `{ opIndex, code, message }`, §14 rollback semantics).
 * `opIndex` is `null` when the server answered 422 without a parsable index
 * (callers must then treat the batch as transiently failed rather than guess).
 */
export class OpRejectedError extends TransportError {
  constructor(
    public readonly opIndex: number | null,
    code: string,
    message: string,
  ) {
    super(code, message, 422);
    this.name = "OpRejectedError";
  }
}

/**
 * `402 PLAN_LIMIT` (§13/§14) — the workspace's plan cannot do this. Carries
 * the §13 capability + cheapest satisfying plan when the §4 error details
 * include them (planLimitError's `{ path: 'capability' | 'requiredPlan' }`).
 */
export class PlanLimitError extends TransportError {
  constructor(
    message: string,
    public readonly capability: string | null,
    public readonly requiredPlan: string | null,
  ) {
    super("PLAN_LIMIT", message, 402);
    this.name = "PlanLimitError";
  }
}

/** `403 FORBIDDEN` (§14) — not allowed for this credential/plan. */
export class ForbiddenError extends TransportError {
  constructor(message: string) {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

/** `ops[3].id` → 3 (the §4 detail path is where the current server buries it). */
function opIndexFromDetails(details: unknown): number | null {
  if (!Array.isArray(details)) return null;
  for (const item of details) {
    const path = typeof item === "object" && item !== null ? (item as { path?: unknown }).path : undefined;
    if (typeof path !== "string") continue;
    const match = /^ops\[(\d+)\]/.exec(path);
    if (match) return Number.parseInt(match[1] ?? "", 10);
  }
  return null;
}

/** `details: [{ rev: 4 }]` → 4 (legacy conflict-detail fallback). */
function revFromDetails(details: unknown): number | null {
  if (!Array.isArray(details)) return null;
  for (const item of details) {
    const rev = typeof item === "object" && item !== null ? (item as { rev?: unknown }).rev : undefined;
    if (typeof rev === "number") return rev;
  }
  return null;
}

/** Parse a 422 response into OpRejectedError (spec §22.1 wire shape first). */
async function parseOpRejected(res: Response): Promise<OpRejectedError> {
  let opIndex: number | null = null;
  let code = "VALIDATION";
  let message = `Request failed with ${res.status}`;
  let details: unknown;
  try {
    const body = (await res.json()) as ErrorBody & { opIndex?: unknown; code?: unknown; message?: unknown };
    if (typeof body.opIndex === "number") opIndex = body.opIndex;
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string") message = body.message;
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
  } catch {
    // non-JSON body — keep defaults
  }
  if (opIndex === null) opIndex = opIndexFromDetails(details);
  return new OpRejectedError(opIndex, code, message);
}

/**
 * True when the response means "no (valid) credentials" — re-authable, unlike
 * a permission failure. HTTP 401 always qualifies; a 403 FORBIDDEN qualifies
 * only with the server's "Authentication required" message (the §4 vocabulary
 * has no 401 — see app/api/v1/_lib/auth.ts). Matched on the message prefix,
 * not on `details` (only the credential path answers without details, and
 * details shapes are not part of the contract).
 */
function isAuthRequired(status: number, code: string, message: string): boolean {
  if (status === 401) return true;
  return status === 403 && code === "FORBIDDEN" && /^Authentication required\b/.test(message);
}

/** `details: [{ path: 'capability', message: 'customRedirect' }]` → value. */
function detailValue(details: unknown, path: string): string | null {
  if (!Array.isArray(details)) return null;
  for (const item of details) {
    const record = typeof item === "object" && item !== null ? (item as { path?: unknown; message?: unknown }) : undefined;
    if (record?.path === path && typeof record.message === "string") return record.message;
  }
  return null;
}

async function parseError(res: Response): Promise<TransportError> {
  let code = "INTERNAL";
  let message = `Request failed with ${res.status}`;
  let details: unknown;
  try {
    const body = (await res.json()) as ErrorBody;
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
  } catch {
    // non-JSON error body — keep defaults
  }
  if (isAuthRequired(res.status, code, message)) {
    return new UnauthenticatedError(code, message, res.status, details);
}

  // §14 inline plan-limit explanations: 402 PLAN_LIMIT and 403 FORBIDDEN get
  // typed errors so the autosave controller can park + explain (never retry
  // them like transient failures).
  if (res.status === 402 || code === "PLAN_LIMIT") {
    return new PlanLimitError(message, detailValue(details, "capability"), detailValue(details, "requiredPlan"));
  }
  if (res.status === 403 || code === "FORBIDDEN") {
    return new ForbiddenError(message);
  }
  return new TransportError(code, message, res.status, details);
}

export class ApiTransport implements DocumentTransport {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async load(docId: string): Promise<DocumentEnvelope> {
    const res = await this.fetchFn(`${this.baseUrl}/documents/${encodeURIComponent(docId)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw await parseError(res);
    const json = (await res.json()) as Partial<DocumentEnvelope> & { document?: Partial<DocumentEnvelope> };
    const env = (json.document ?? json) as DocumentEnvelope;
    if (!env || typeof env.rev !== "number" || !env.body) {
      throw new TransportError("INTERNAL", "Malformed document payload", res.status);
    }
    return env;
  }

  async patch(docId: string, baseRev: number, ops: readonly Op[]): Promise<PatchResult> {
    const res = await this.fetchFn(`${this.baseUrl}/documents/${encodeURIComponent(docId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // keepalive: best-effort delivery for the pagehide flush
      keepalive: true,
      body: JSON.stringify({ baseRev, ops }),
    });
    if (res.status === 409) {
      // Spec §22.1: `409 { rev, body }` on the top level. Older shape kept as
      // a fallback: rev inside the `error.details` list.
      let rev = baseRev;
      let body: DocumentBody | undefined;
      try {
        const json = (await res.json()) as ErrorBody & { rev?: number; body?: DocumentBody };
        if (typeof json.rev === "number") rev = json.rev;
        else {
          const fromDetails = revFromDetails(json.error?.details);
          if (fromDetails !== null) rev = fromDetails;
        }
        body = json.body;
      } catch {
        // no details available
      }
      throw new ConflictError(rev, "Document changed on the server", body);
    }
    if (res.status === 422) throw await parseOpRejected(res);
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as PatchResult;
  }

  async publish(docId: string): Promise<{ status: DocumentStatus }> {
    const res = await this.fetchFn(`${this.baseUrl}/documents/${encodeURIComponent(docId)}/publish`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as { status: DocumentStatus };
  }
}

// ---------------------------------------------------------------------------
// MockTransport
// ---------------------------------------------------------------------------

/** Index of the first op that fails to apply on `doc` (mock-server helper). */
function firstFailingIndex(doc: EditableDoc, ops: readonly Op[]): number | null {
  let sim = doc;
  for (let i = 0; i < ops.length; i++) {
    try {
      sim = applyOps(sim, [ops[i] as Op]);
    } catch {
      return i;
    }
  }
  return null;
}

export type MockTransportOptions = {
  /** Simulated latency in ms; a number or a sampler. Default: 40–120ms. */
  latencyMs?: number | (() => number);
  seed?: DocumentEnvelope[];
};

export class MockTransport implements DocumentTransport {
  private docs = new Map<string, DocumentEnvelope>();
  private latency: () => number;

  constructor(options: MockTransportOptions = {}) {
    this.latency =
      typeof options.latencyMs === "function"
        ? options.latencyMs
        : options.latencyMs !== undefined
          ? () => options.latencyMs as number
          : () => 40 + Math.floor(Math.random() * 80);
    for (const env of options.seed ?? []) this.docs.set(env.id, structuredClone(env));
  }

  private delay(): Promise<void> {
    const ms = this.latency();
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
  }

  async load(docId: string): Promise<DocumentEnvelope> {
    await this.delay();
    const doc = this.docs.get(docId);
    if (!doc) throw new TransportError("NOT_FOUND", `Document ${docId} not found`, 404);
    return structuredClone(doc);
  }

  async patch(docId: string, baseRev: number, ops: readonly Op[]): Promise<PatchResult> {
    await this.delay();
    const doc = this.docs.get(docId);
    if (!doc) throw new TransportError("NOT_FOUND", `Document ${docId} not found`, 404);
    if (doc.rev !== baseRev) {
      throw new ConflictError(doc.rev, `Stale revision (have ${baseRev}, server ${doc.rev})`, doc.body);
    }
    const editable: EditableDoc = {
      meta: { title: doc.title, slug: doc.slug },
      body: doc.body,
    };
    let next: EditableDoc = editable;
    try {
      for (let i = 0; i < ops.length; i++) {
        next = applyOps(next, [ops[i] as Op]);
      }
    } catch (err) {
      // Mimic the server's §22.1 422: exactly one op rejected with its index
      // (op failures are always field-level VALIDATION 422s on the wire).
      const failing = firstFailingIndex(editable, ops);
      throw new OpRejectedError(
        failing,
        "VALIDATION",
        `Invalid ops: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    doc.rev += 1;
    doc.title = next.meta.title;
    doc.slug = next.meta.slug;
    doc.body = next.body;
    doc.updatedAt = new Date().toISOString();
    return { rev: doc.rev, body: doc.body };
  }

  async publish(docId: string): Promise<{ status: DocumentStatus }> {
    await this.delay();
    const doc = this.docs.get(docId);
    if (!doc) throw new TransportError("NOT_FOUND", `Document ${docId} not found`, 404);
    doc.status = "published";
    return { status: doc.status };
  }

  // --- test / dev helpers --------------------------------------------------

  /** Simulates a concurrent writer advancing the server revision. */
  bumpRev(docId: string): void {
    const doc = this.docs.get(docId);
    if (doc) doc.rev += 1;
  }

  getDoc(docId: string): DocumentEnvelope | undefined {
    const doc = this.docs.get(docId);
    return doc ? structuredClone(doc) : undefined;
  }

  seed(env: DocumentEnvelope): void {
    this.docs.set(env.id, structuredClone(env));
  }
}

/** Sample document used by the dev fallback when no API is reachable. */
export function seedEnvelope(docId: string, title = "Product feedback"): DocumentEnvelope {
  return {
    id: docId,
    rev: 1,
    title,
    slug: "product-feedback",
    status: "draft",
    type: "form",
    updatedAt: new Date().toISOString(),
    body: {
      schemaVersion: 1,
      type: "form",
      theme: {
        tokens: {
          "color.bg": "#fbf9f4",
          "color.fg": "#1c1917",
          "color.primary": "#4f46e5",
          "color.primaryFg": "#ffffff",
          "color.muted": "#78716c",
          "color.border": "#e7e5e4",
        },
        fontHeading: "Inter",
        fontBody: "Inter",
        radius: "md",
      },
      settings: {
        seo: {},
        locale: "en",
        progressBar: true,
        autoAdvance: true,
        showBranding: true,
        captcha: false,
        notifyEmails: [],
      },
      blocks: [
        { id: "demoq1", kind: "short-text", props: { label: "What's your name?", placeholder: "Ada Lovelace", required: true } },
        { id: "demoq2", kind: "email", props: { label: "Work email", required: true } },
        { id: "demoq3", kind: "rating", props: { label: "How would you rate us?", scale: 5 } },
        {
          id: "demoq4",
          kind: "single-select",
          props: {
            label: "What should we build next?",
            allowOther: true,
            options: [
              { id: "opt1", label: "More templates" },
              { id: "opt2", label: "Logic builder" },
              { id: "opt3", label: "Dark mode" },
            ],
          },
        },
      ],
      endings: [{ id: "end1", title: "Thanks a bunch! 🎉", body: "Your feedback just made our roadmap better." }],
      logic: { rules: [] },
    },
  };
}

/** Dev toggle: `NEXT_PUBLIC_FF_MOCK_BUILDER=1` forces the in-memory transport. */
export function createTransport(): DocumentTransport {
  const forcedMock = process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1";
  if (forcedMock) {
    return new MockTransport({ seed: [seedEnvelope("demo")] });
  }
  return new ApiTransport();
}
