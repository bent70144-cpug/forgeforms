/**
 * T10 — POST /api/v1/documents/:id/publish (spec §8, §11; scope docs:publish).
 *
 * Thin handler: auth seam → publish service → Result mapped to HTTP per §4.
 * 200 { url, documentId, versionId, version, reused } | 404 | 409 | 422.
 */
import type { NextRequest } from 'next/server';
import { documentsApi } from '@/lib/api/documents';
import { requireUser } from '@/lib/api/auth';
import { errorResponse, jsonOk } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireUser(request, 'docs:publish');
  if (!auth.ok) return errorResponse(auth.error);

  const { id } = await context.params;
  const result = await documentsApi.publishDocument(auth.value, id);
  if (!result.ok) return errorResponse(result.error);

  return jsonOk(result.value);
}
