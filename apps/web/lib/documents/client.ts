// T07 — browser client for the documents API (spec §11 + §4 conventions).
//
// Thin fetch glue for the dashboard UI: parses the §4 pagination envelope and
// maps every non-2xx to `DocumentsApiError` carrying the §4 code + field
// details, so components can show exactly what the server rejected.
// Server-side composition (repos, services) lives in lib/api/documents.ts.

export type DocumentType = 'form' | 'page' | 'portfolio';
export type DocumentStatus = 'draft' | 'published' | 'archived';

export type DocumentSummaryDto = {
  id: string;
  type: DocumentType;
  title: string;
  slug: string;
  status: DocumentStatus;
  rev: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentDetailDto = DocumentSummaryDto & {
  draft: unknown;
  publishedVersionId: string | null;
};

export type ApiErrorDetail = { path?: string; message: string };

/** §4 error envelope, surfaced as an exception. */
export class DocumentsApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'DocumentsApiError';
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: ApiErrorDetail[] } };

async function readError(res: Response): Promise<DocumentsApiError> {
  try {
    const body = (await res.json()) as ErrorBody;
    return new DocumentsApiError(
      body.error?.code ?? 'INTERNAL',
      body.error?.message ?? `Request failed (${res.status})`,
      res.status,
      body.error?.details,
    );
  } catch {
    return new DocumentsApiError('INTERNAL', `Request failed (${res.status})`, res.status);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export type ListDocumentsQuery = {
  type?: DocumentType;
  status?: DocumentStatus;
  q?: string;
  cursor?: string | null;
  limit?: number;
};

/** GET /documents — §4 pagination envelope `{ data, nextCursor }`. */
export async function listDocuments(
  query: ListDocumentsQuery = {},
): Promise<{ data: DocumentSummaryDto[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  const res = await fetch(`/api/v1/documents${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  return readJson<{ data: DocumentSummaryDto[]; nextCursor: string | null }>(res);
}

export type CreateDocumentInput = {
  type: DocumentType;
  title: string;
  /** §14.1.2 create modal: "start from template" — omit for blank. */
  templateId?: string;
};

/** POST /documents — 201 with the created detail (rev 0, empty/template body). */
export async function createDocument(input: CreateDocumentInput): Promise<DocumentDetailDto> {
  const res = await fetch('/api/v1/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<DocumentDetailDto>(res);
}

/** POST /documents/:id/duplicate — deep copy, "(copy)" title, rev 0 draft. */
export async function duplicateDocument(id: string): Promise<DocumentDetailDto> {
  const res = await fetch(`/api/v1/documents/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  return readJson<DocumentDetailDto>(res);
}

/** DELETE /documents/:id — soft-delete (archive). Resolves void on 204. */
export async function archiveDocument(id: string): Promise<void> {
  const res = await fetch(`/api/v1/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw await readError(res);
}
