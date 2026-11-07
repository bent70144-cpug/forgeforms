/**
 * T07 — GET/PATCH/DELETE /api/v1/documents/:id (spec §8, §11).
 *
 * GET     the builder envelope (draft body + metadata; T08 DocumentTransport)
 *         + the §24 `entitlements` surface resolved via billing for the
 *         workspace's plan (additive; free-plan default when billing is
 *         unreachable — follow-up #8).
 * PATCH   applies `{ baseRev, ops }` in one transaction against the draft,
 *         validates the result with DocumentBody, increments `rev`. A stale
 *         baseRev → 409 CONFLICT carrying the CURRENT rev + body (spec §8).
 * DELETE  soft-delete → status archived (204).
 */
import { requireScope } from '@formforge/core/api';
import { PatchDocumentRequestSchema } from '@formforge/schema/api';
import { authenticate } from '../../_lib/auth';
import { handleApiError, noContent } from '../../_lib/respond';
import { jsonOk } from '@/lib/api/http';
import { documentsCrud, toDocumentEnvelope } from '@/lib/api/documents';
import { builderEntitlementsFor } from '@/lib/api/entitlements';

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

    const result = await documentsCrud.get(ctx, id);
    if (!result.ok) return handleApiError(result.error);
    const entitlements = await builderEntitlementsFor(ctx.workspaceId);
    return jsonOk(toDocumentEnvelope(result.value, entitlements));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:write');
    const { id } = await context.params;

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      payload = undefined;
    }
    const parsed = PatchDocumentRequestSchema.safeParse(payload);
    if (!parsed.success) throw parsed.error;

    const result = await documentsCrud.patch(ctx, id, parsed.data);
    if (!result.ok) return handleApiError(result.error);

    // 200 { rev, updatedAt, body } — the autosave client adopts this rev+body.
    return jsonOk({
      rev: result.value.rev,
      updatedAt: result.value.updatedAt.toISOString(),
      body: result.value.draft,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req);
    requireScope(ctx.scopes, 'docs:write');
    const { id } = await context.params;

    const result = await documentsCrud.archive(ctx, id);
    if (!result.ok) return handleApiError(result.error);
    return noContent();
  } catch (error) {
    return handleApiError(error);
  }
}
