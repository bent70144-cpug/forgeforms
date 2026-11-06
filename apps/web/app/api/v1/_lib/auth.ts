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
  type Role,
} from '@formforge/core/api';
import { getApiTokenStoreFromEnv } from '../../../../../../packages/db/src/repositories/api-tokens';
// T03 session reader — imported DYNAMICALLY in sessionCtx so this module (and
// thus every /api/v1 route) never pulls next/headers + the identity/DB graph
// at module scope; unit tests inject a fake via `sessionLoader` instead.
import type { AuthenticatedSession } from '@formforge/core/identity';
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

/** Injectable session reader (DI for tests); defaults to T03's cookie session. */
export type SessionLoader = () => Promise<AuthenticatedSession | null>;

/**
 * Default session reader — DYNAMIC import so this module (and thus every
 * /api/v1 route) never pulls next/headers + the identity/DB graph at module
 * scope; unit tests inject a fake via `sessionLoader` instead.
 */
async function defaultSessionLoader(): Promise<AuthenticatedSession | null> {
  const mod = await import('@/lib/auth/session');
  return mod.getCurrentSession();
}

export interface AuthenticateOptions {
  /** `false` → session-only routes (e.g. token management, spec §11). */
  readonly allowToken?: boolean;
  /** DI for tests; defaults to the env-backed Drizzle store. */
  readonly store?: ApiTokenStore;
  /** DI for tests; defaults to `@/lib/auth/session#getCurrentSession`. */
  readonly sessionLoader?: SessionLoader;
  readonly now?: () => Date;
}

/** DI default: the env-backed Drizzle store (INTEGRATION-DEBT: T02 client factory). */
export function tokenStore(): ApiTokenStore {
  return getApiTokenStoreFromEnv();
}

/**
 * Session path (T03/T07): the browser session cookie resolves to the user's
 * active workspace + membership role. Roles map to the §11 scope vocabulary so
 * `requireScope` works uniformly for both credential kinds:
 *   owner/admin/editor → all document scopes; viewer → read-only.
 * Throws FORBIDDEN (never returns null) when a session exists but has no
 * active workspace — documents are always workspace-scoped (spec §6).
 */
const SESSION_SCOPES_FULL = ['docs:read', 'docs:write', 'docs:publish', 'submissions:read'] as const;
const SESSION_SCOPES_READONLY = ['docs:read', 'submissions:read'] as const;

export function scopesForRole(role: Role | null): readonly string[] {
  return role === 'owner' || role === 'admin' || role === 'editor'
    ? SESSION_SCOPES_FULL
    : SESSION_SCOPES_READONLY;
}

async function sessionCtx(req: Request, loadSession: SessionLoader): Promise<Ctx> {
  // ANY session-resolution failure (no cookie, expired, no request scope in
  // tests, DB down) is "no credentials" from the API's perspective — the §4
  // vocabulary has no 401, so it answers FORBIDDEN (403), never 500.
  let session: AuthenticatedSession | null;
  try {
    session = await loadSession();
  } catch {
    session = null;
  }
  if (!session) {
    throw AppError.forbidden('Authentication required: session cookie or Authorization: Bearer ff_…');
  }
  if (!session.workspace) {
    throw AppError.forbidden('No active workspace for this session', [
      { path: 'workspace', message: 'Finish onboarding before using the API' },
    ]);
  }
  const base = makeCtx({
    workspaceId: session.workspace.id,
    actor: {
      kind: 'session',
      userId: session.user.id,
      role: session.role ?? 'viewer',
    },
    requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
    now: () => new Date(),
  });
  // makeCtx only derives scopes from token actors; sessions carry the role map.
  return { ...base, scopes: scopesForRole(session.role) };
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

  // NOTE: the arrow is parenthesized — `?? async () => {…}` after a
  // line-comment breaks vite/oxc's parser (verified in isolation).
  const loadSession: SessionLoader = options.sessionLoader ?? defaultSessionLoader;
  const session = await sessionCtx(req, loadSession);
  assertRateLimit(`session:${session.userId ?? 'anon'}`, SESSION_RATE_LIMIT_PER_MINUTE);
  return session;
}
