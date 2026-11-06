/**
 * T10 — POST /api/v1/documents/:id/publish (spec §8, §11; scope docs:publish).
 *
 * Thin handler: unified `authenticate` seam (T07) → publish service → Result
 * mapped to HTTP per §4. 200 { url, documentId, versionId, version, reused }
 * | 403 | 404 | 409 | 422.
 */
import { requireScope } from '@formforge/core/api';
import { authenticate } from '../../../_lib/auth';
import { handleApiError, ok } from '../../../_lib/respond';
import { documentsApi } from '@/lib/api/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:publish');
    const { id } = await context.params;

    const result = await documentsApi.publishDocument(ctx, id);
    if (!result.ok) return handleApiError(result.error);
    return ok(result.value);
  } catch (error) {
    return handleApiError(error);
  }
}
