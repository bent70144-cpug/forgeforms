// GET /api/v1/tokens — list API tokens (session only, spec §11).
// POST /api/v1/tokens — create (plaintext revealed EXACTLY ONCE).
// DELETE /api/v1/tokens?id=… — revoke.
import { createToken, listTokens, revokeToken } from '@formforge/core/api';
import { CreateTokenRequestSchema, CreateTokenResponseSchema, RevokeTokenRequestSchema } from '@formforge/schema/api';
import { authenticate, tokenStore } from '../_lib/auth';
import { created, handleApiError, listResponse, noContent } from '../_lib/respond';

export const dynamic = 'force-dynamic';

/** List the session workspace's tokens (hash-free DTOs, no plaintext). */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: false });
    const tokens = await listTokens(ctx, tokenStore());
    // Token lists are small per workspace — envelope kept §4-shaped, no cursor.
    return listResponse(tokens, null);
  } catch (error) {
    return handleApiError(error);
  }
}

/** Create a token. Response carries the plaintext once; only the SHA-256 hash is stored. */
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: false });
    const json: unknown = await req.json().catch(() => null);
    const parsed = CreateTokenRequestSchema.safeParse(json);
    if (!parsed.success) throw parsed.error;
    // INTEGRATION-DEBT: awaiting T04 — enforce owner/admin role here once
    // session roles land (tokens CRUD is owner/admin territory per spec §6).
    const { token, record } = await createToken(ctx, tokenStore(), parsed.data);
    // Self-check: the response always satisfies the published contract.
    return created(CreateTokenResponseSchema.parse({ ...record, token }));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Revoke (delete) a token by id — it stops authenticating immediately. */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: false });
    const id = new URL(req.url).searchParams.get('id');
    const parsed = RevokeTokenRequestSchema.safeParse({ id });
    if (!parsed.success) throw parsed.error;
    await revokeToken(ctx, tokenStore(), parsed.data.id);
    return noContent();
  } catch (error) {
    return handleApiError(error);
  }
}
