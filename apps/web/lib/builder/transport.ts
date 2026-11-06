// DocumentTransport — the builder's seam to the documents API (spec §11).
//
// - ApiTransport talks to `PATCH /api/v1/documents/:id` with `{ baseRev, ops }`
//   and maps `409 CONFLICT` to ConflictError carrying the server's current rev.
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

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

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
      let rev = baseRev;
      let body: DocumentBody | undefined;
      try {
        const json = (await res.json()) as ErrorBody & { rev?: number; body?: DocumentBody };
        const details = json.error?.details as { rev?: number } | undefined;
        if (typeof json.rev === "number") rev = json.rev;
        else if (typeof details?.rev === "number") {
          rev = details.rev;
        }
        body = json.body;
      } catch {
        // no details available
      }
      throw new ConflictError(rev, "Document changed on the server", body);
    }
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
    let next: EditableDoc;
    try {
      next = applyOps(editable, ops);
    } catch (err) {
      throw new TransportError(
        "VALIDATION",
        `Invalid ops: ${err instanceof Error ? err.message : String(err)}`,
        422,
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
