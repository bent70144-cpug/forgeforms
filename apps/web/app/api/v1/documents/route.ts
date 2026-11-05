// SPEC-NOTE: DEMO route scaffolded by T25 (issue #25) to prove the
// bearer → Ctx → scope guard → §4 response path end-to-end for /api/v1.
// T07 (documents API, issue #7) owns the real documents implementation and
// should replace this file wholesale. Only GET is provided — document
// persistence (documents table, RLS, ops) lands with T02/T07.
import { requireScope } from '@formforge/core/api';
import { ListDocumentsQuerySchema } from '@formforge/schema/api';
import { authenticate } from '../_lib/auth';
import { handleApiError, listResponse } from '../_lib/respond';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/documents — docs:read.
 * Returns a §4-shaped empty page until T07 wires the documents repository.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:read');

    const url = new URL(req.url);
    const query = ListDocumentsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) throw query.error;

    // INTEGRATION-DEBT: awaiting T07 — documents repository (documents table,
    // RLS via T02 helper, type/status/q filters, cursor pagination).
    return listResponse([], null);
  } catch (error) {
    return handleApiError(error);
  }
}
