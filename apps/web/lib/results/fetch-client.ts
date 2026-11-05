// T15 — live `ResultsClient` against spec §11 authenticated API.
// SPEC-NOTE: exact query-param names for sort are not pinned by the spec; we
// send `sort=submitted_at&order=asc|desc`. When T14's route contract lands,
// adjust `buildListQuery` only — nothing else in T15 touches the wire format.

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  ResultsApiError,
  type ApiErrorCode,
  type ResultsClient,
} from "./client";
import type {
  DocumentSummary,
  ListSubmissionsParams,
  SubmissionDTO,
  SubmissionsPage,
  SummaryResponse,
} from "./types";

const KNOWN_STATUSES: ReadonlySet<string> = new Set(["draft", "completed", "spam"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `{ data: … }` envelope (spec §4/§11) → inner value; passes through raw objects. */
function unwrapEnvelope(value: unknown): unknown {
  if (isRecord(value) && "data" in value) return value.data;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asRecordMap(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Defensive row normalization — a bad payload degrades to "—", never a crash. */
export function normalizeSubmission(value: unknown): SubmissionDTO {
  const rec = asRecord(value);
  const status = typeof rec.status === "string" && KNOWN_STATUSES.has(rec.status)
    ? (rec.status as SubmissionDTO["status"])
    : "completed";
  return {
    id: typeof rec.id === "string" ? rec.id : "",
    documentId: typeof rec.documentId === "string" ? rec.documentId : "",
    versionId: typeof rec.versionId === "string" ? rec.versionId : "",
    status,
    publicToken: typeof rec.publicToken === "string" ? rec.publicToken : "",
    answers: asRecordMap(rec.answers),
    variables: asRecordMap(rec.variables),
    hidden: asRecordMap(rec.hidden),
    meta: asRecordMap(rec.meta),
    startedAt: typeof rec.startedAt === "string" ? rec.startedAt : new Date(0).toISOString(),
    completedAt: typeof rec.completedAt === "string" ? rec.completedAt : null,
  };
}

function normalizeDocument(value: unknown): DocumentSummary {
  const rec = asRecord(value);
  const body = asRecord(rec.body);
  const type = rec.type === "page" || rec.type === "portfolio" ? rec.type : "form";
  const status =
    rec.status === "draft" || rec.status === "published" || rec.status === "archived"
      ? rec.status
      : "draft";
  return {
    id: typeof rec.id === "string" ? rec.id : "",
    title: typeof rec.title === "string" && rec.title.length > 0 ? rec.title : "Untitled",
    type,
    status,
    slug: typeof rec.slug === "string" && rec.slug.length > 0 ? rec.slug : "document",
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : null,
    body: {
      schemaVersion: 1,
      type,
      theme: asRecord(body.theme) as DocumentSummary["body"]["theme"],
      settings: asRecord(body.settings) as DocumentSummary["body"]["settings"],
      blocks: Array.isArray(body.blocks) ? (body.blocks as DocumentSummary["body"]["blocks"]) : [],
      endings: Array.isArray(body.endings)
        ? (body.endings as DocumentSummary["body"]["endings"])
        : [],
      logic: { rules: [] },
    },
  };
}

/** Accept either the bare SummaryResponse or a `{ data: … }` envelope. */
function normalizeSummary(value: unknown): SummaryResponse {
  const rec = asRecord(value);
  const countsRec = asRecord(rec.counts);
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    counts: {
      total: num(countsRec.total),
      completed: num(countsRec.completed),
      draft: num(countsRec.draft),
      spam: num(countsRec.spam),
      completionRate: num(countsRec.completionRate),
    },
    blocks: Array.isArray(rec.blocks)
      ? (rec.blocks as SummaryResponse["blocks"])
      : [],
    generatedAt: typeof rec.generatedAt === "string" ? rec.generatedAt : new Date(0).toISOString(),
  };
}

async function parseErrorBody(body: unknown): Promise<{ code: ApiErrorCode; message: string } | null> {
  if (!isRecord(body)) return null;
  const err = asRecord(body.error);
  const code = typeof err.code === "string" ? err.code : null;
  const message = typeof err.message === "string" ? err.message : "Request failed";
  const known: ReadonlySet<string> = new Set([
    "NOT_FOUND",
    "FORBIDDEN",
    "VALIDATION",
    "CONFLICT",
    "RATE_LIMITED",
    "PLAN_LIMIT",
    "INTERNAL",
  ]);
  if (code && known.has(code)) return { code: code as ApiErrorCode, message };
  return null;
}

export interface FetchResultsClientOptions {
  /** Base for `/api/v1`; defaults to same-origin `/api/v1` (spec §11). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class FetchResultsClient implements ResultsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchResultsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/v1").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async getJson(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new ResultsApiError("INTERNAL", "Network error — could not reach the API");
    }
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const parsed = await parseErrorBody(body);
      if (parsed) throw new ResultsApiError(parsed.code, parsed.message, res.status);
      if (res.status === 404) throw new ResultsApiError("NOT_FOUND", "Not found", 404);
      if (res.status === 403) throw new ResultsApiError("FORBIDDEN", "Not allowed", 403);
      if (res.status === 429) throw new ResultsApiError("RATE_LIMITED", "Too many requests", 429);
      throw new ResultsApiError("INTERNAL", `Request failed with ${res.status}`, res.status);
    }
    try {
      return await res.json();
    } catch {
      throw new ResultsApiError("INTERNAL", "Malformed JSON response");
    }
  }

  /** spec §4 — `?limit=50&cursor=<opaque>`; status filter + submitted_at sort. */
  static buildListQuery(params: ListSubmissionsParams = {}): string {
    const query = new URLSearchParams();
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, params.limit ?? DEFAULT_PAGE_SIZE),
    );
    query.set("limit", String(limit));
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.status && params.status !== "all") query.set("status", params.status);
    // SPEC-NOTE: sort param names await T14's pinned contract (see file header).
    query.set("sort", "submitted_at");
    query.set("order", params.sort === "oldest" ? "asc" : "desc");
    return query.toString();
  }

  private pageFrom(value: unknown): SubmissionsPage {
    const raw = unwrapEnvelope(value);
    const rec = asRecord(raw);
    const rows = Array.isArray(rec.data) ? rec.data.map(normalizeSubmission) : null;
    if (!rows) throw new ResultsApiError("INTERNAL", "Unexpected submissions payload");
    return {
      data: rows,
      nextCursor: typeof rec.nextCursor === "string" && rec.nextCursor.length > 0 ? rec.nextCursor : null,
    };
  }

  async getDocument(documentId: string): Promise<DocumentSummary> {
    return normalizeDocument(unwrapEnvelope(await this.getJson(`/documents/${encodeURIComponent(documentId)}`)));
  }

  async listSubmissions(
    documentId: string,
    params: ListSubmissionsParams = {},
  ): Promise<SubmissionsPage> {
    const qs = FetchResultsClient.buildListQuery(params);
    return this.pageFrom(await this.getJson(`/documents/${encodeURIComponent(documentId)}/submissions?${qs}`));
  }

  async getSubmission(documentId: string, submissionId: string): Promise<SubmissionDTO> {
    return normalizeSubmission(
      unwrapEnvelope(
        await this.getJson(
          `/documents/${encodeURIComponent(documentId)}/submissions/${encodeURIComponent(submissionId)}`,
        ),
      ),
    );
  }

  async getSummary(documentId: string): Promise<SummaryResponse> {
    return normalizeSummary(
      unwrapEnvelope(await this.getJson(`/documents/${encodeURIComponent(documentId)}/summary`)),
    );
  }
}
