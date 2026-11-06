/**
 * T07 — GET/POST /api/v1/documents (spec §11; scopes docs:read / docs:write).
 *
 * GET   list with filters (type, status, q) + §4 cursor pagination.
 * POST  create `{ type, title, templateId? }` — an empty DocumentBody per type,
 *       or the template body (spec §14.1.2 "blank/template").
 *
 * Replaces the T25 demo scaffold (which returned an empty page).
 */
import { requireScope } from '@formforge/core/api';
import {
  CreateDocumentRequestSchema,
  ListDocumentsQuerySchema,
} from '@formforge/schema/api';
import { authenticate } from '../_lib/auth';
import { handleApiError, created, listResponse } from '../_lib/respond';
import { documentsCrud, toDocumentDetail, toDocumentSummary } from '@/lib/api/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:read');

    const url = new URL(req.url);
    const query = ListDocumentsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) throw query.error;

    const page = await documentsCrud.list(ctx, {
      type: query.data.type,
      status: query.data.status,
      q: query.data.q,
      limit: query.data.limit,
      cursor: query.data.cursor,
    });
    if (!page.ok) return handleApiError(page.error);

    return listResponse(page.value.items.map(toDocumentSummary), page.value.nextCursor);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:write');

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const parsed = CreateDocumentRequestSchema.safeParse(body);
    if (!parsed.success) throw parsed.error;

    const result = await documentsCrud.create(ctx, parsed.data);
    if (!result.ok) return handleApiError(result.error);

    return created(toDocumentDetail(result.value));
  } catch (error) {
    return handleApiError(error);
  }
}
