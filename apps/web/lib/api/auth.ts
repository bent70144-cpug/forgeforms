/**
 * T10 — auth seam for /api/v1 document routes (spec §11).
 *
 * `requireUser(request, scope)` is the ONLY thing routes call. The real
 * implementation (session cookie via Auth.js v5 / bearer token with
 * `docs:publish` scope checks) is owned by T03/T25 — they inject it with
 * `setAuthResolver` at boot; until then a dev-only header fallback applies and
 * every other request gets FORBIDDEN (403).
 */
import { AppError, err, ok, type Ctx, type Result } from '@formforge/core';

export type ApiScope =
  | 'docs:read'
  | 'docs:write'
  | 'docs:publish'
  | 'submissions:read'
  | 'session';

export type AuthResolver = (
  request: Request,
  scope: ApiScope,
) => Promise<Result<Ctx, AppError>>;

let resolver: AuthResolver | null = null;

/** INTEGRATION-DEBT: awaiting T03/T25 — wire the real session/token resolver here. */
export function setAuthResolver(next: AuthResolver): void {
  resolver = next;
}

export async function requireUser(
  request: Request,
  scope: ApiScope,
): Promise<Result<Ctx, AppError>> {
  if (resolver) return resolver(request, scope);
  return devFallback(request);
}

/**
 * Dev-only fallback: `FORMFORGE_DEV_AUTH=1` plus `x-workspace-id` /
 * `x-user-id` headers. Never enabled implicitly — production must inject a
 * real resolver (or this returns FORBIDDEN for every request).
 */
async function devFallback(request: Request): Promise<Result<Ctx, AppError>> {
  if (process.env['FORMFORGE_DEV_AUTH'] === '1') {
    const workspaceId = request.headers.get('x-workspace-id');
    const userId = request.headers.get('x-user-id');
    if (workspaceId && userId) {
      return ok({
        workspaceId,
        actor: { type: 'user', id: userId },
        requestId: crypto.randomUUID(),
        now: () => new Date(),
      });
    }
  }
  return err(new AppError('FORBIDDEN', 'Authentication required'));
}
