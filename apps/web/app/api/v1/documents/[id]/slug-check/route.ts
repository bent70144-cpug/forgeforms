/**
 * Follow-up #5 (docs/builder-audit.md, §6.6/§22.1, §14) —
 * GET /api/v1/documents/:id/slug-check?q=<slug> (scope docs:read).
 *
 * Builder settings panel probe: is `slug` free for this document within the
 * session's/token's workspace? The checked document itself is excluded, and a
 * taken slug carries the first free `-2`, `-3`, … suggestion. READ-ONLY —
 * saving still enforces uniqueness server-side at PATCH time.
 *
 * 200 { available, suggestion? } | 403 | 404 | 422 (missing/malformed `q`).
 */
import { AppError, requireScope } from '@formforge/core/api';
import { authenticate } from '../../../_lib/auth';
import { handleApiError, ok } from '../../../_lib/respond';
import { documentsCrud } from '@/lib/api/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:read');
    const { id } = await context.params;

    const q = new URL(req.url).searchParams.get('q');
    if (q === null || q === '') {
      throw AppError.validation('Invalid input', [{ path: 'q', message: 'Required' }]);
    }

    const result = await documentsCrud.slugCheck(ctx, id, q);
    if (!result.ok) return handleApiError(result.error);
    return ok(result.value);
  } catch (error) {
    return handleApiError(error);
  }
}
