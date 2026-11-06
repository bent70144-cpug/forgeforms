/**
 * T07 — POST /api/v1/documents/:id/duplicate (spec §11 "Copy", docs:write).
 * Deep-copies the draft into a fresh draft document (`Title (copy)`), with a
 * workspace-unique slug; publish state does NOT carry over.
 */
import { requireScope } from '@formforge/core/api';
import { authenticate } from '../../../_lib/auth';
import { handleApiError, created } from '../../../_lib/respond';
import { documentsCrud, toDocumentDetail } from '@/lib/api/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:write');
    const { id } = await context.params;

    const result = await documentsCrud.duplicate(ctx, id);
    if (!result.ok) return handleApiError(result.error);
    return created(toDocumentDetail(result.value));
  } catch (error) {
    return handleApiError(error);
  }
}
