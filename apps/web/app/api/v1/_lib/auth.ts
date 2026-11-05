// Authentication for /api/v1 (issue #25, spec §11):
//   session cookie OR `Authorization: Bearer ff_…`.
// Workspace comes from the token's workspace (bearer) or the session's active
// workspace (session). Tokens are workspace-bound by construction, so a token
// can never cross workspaces — its id IS the tenant key downstream.
//
// Rate limits (spec §11): 600 req/min per token, 300 req/min per session —
// enforced here so every route inherits it.

import {
  AppError,
  makeCtx,
  verifyToken,
  touchToken,
  type ApiTokenStore,
  type Ctx,
} from '@formforge/core/api';
import { getApiTokenStoreFromEnv } from '../../../../../../packages/db/src/repositories/api-tokens';
import {
  SESSION_RATE_LIMIT_PER_MINUTE,
  TOKEN_RATE_LIMIT_PER_MINUTE,
  assertRateLimit,
} from './rate-limit';

/** Extract the plaintext token from an Authorization header, if well-formed. */
export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export interface AuthenticateOptions {
  /** `false` → session-only routes (e.g. token management, spec §11). */
  readonly allowToken?: boolean;
  /** DI for tests; defaults to the env-backed Drizzle store. */
  readonly store?: ApiTokenStore;
  readonly now?: () => Date;
}

/**
 * INTEGRATION-DEBT: awaiting T03/T04 (Auth.js v5 sessions + roles).
 * Returns the session's Ctx once Auth.js lands; `null` until then, so
 * session-only routes answer FORBIDDEN with a clear message and the tokens
 * UI renders its "sign-in pending" state.
 */
async function sessionCtx(_req: Request): Promise<Ctx | null> {
  void _req;
  return null;
}

/**
 * Resolve the request to a Ctx or throw FORBIDDEN (spec §4 defines no separate
 * 401). Bearer path: verify → rate-limit → touch last_used_at → Ctx.
 */
export async function authenticate(req: Request, options: AuthenticateOptions = {}): Promise<Ctx> {
  const bearer = extractBearer(req.headers.get('authorization'));

  if (bearer) {
    if (options.allowToken === false) {
      throw AppError.forbidden('API tokens cannot manage API tokens — use a browser session', [
        { path: 'authorization', message: 'Token management is session-only' },
      ]);
    }
    const store = options.store ?? getApiTokenStoreFromEnv();
    const verified = await verifyToken(store, bearer);
    assertRateLimit(`token:${verified.id}`, TOKEN_RATE_LIMIT_PER_MINUTE);
    const now = options.now ?? (() => new Date());
    // Best effort: usage tracking must never fail a valid request.
    await touchToken(store, verified.id, now()).catch(() => {});
    return makeCtx({
      workspaceId: verified.workspaceId,
      requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
      actor: { kind: 'token', tokenId: verified.id, scopes: verified.scopes },
      now,
    });
  }

  const session = await sessionCtx(req);
  if (session) {
    assertRateLimit(`session:${session.userId ?? 'anon'}`, SESSION_RATE_LIMIT_PER_MINUTE);
    return session;
  }

  throw AppError.forbidden('Authentication required: session cookie or Authorization: Bearer ff_…');
}
