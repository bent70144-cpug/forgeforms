/**
 * T10 — POST /api/v1/documents/:id/unpublish (spec §8, §11; scope docs:publish).
 *
 * Thin handler: auth seam → unpublish service → Result mapped to HTTP per §4.
 * 200 { documentId, status, unpublished } | 404 | 409. After unpublish the
 * public route serves 410 (reader returns UNPUBLISHED).
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
  const result = await documentsApi.unpublishDocument(auth.value, id);
  if (!result.ok) return errorResponse(result.error);

  return jsonOk(result.value);
}
