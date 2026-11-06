// T04 — tenancy role matrix (spec §6 memberships.role, §11 session routes).
//
// Roles are hierarchical (owner > admin > editor > viewer). The matrix follows
// the ticket brief: viewer can read, editor writes docs, admin manages
// members/settings, owner everything. API-token actors are authorized by
// scopes (`requireScope`) instead — they carry no membership role, so
// `requireRole` fails closed for them.
//
// Session routes (spec §11 "session only"):
//   workspace PATCH + members CRUD → admin (`workspace:manage`)
//   tokens CRUD                    → admin (`tokens:manage`)
//   billing checkout/portal        → owner (`billing:manage`)
// Scoped routes map 1:1 onto API scopes (see ./scopes):
//   docs:read / submissions:read → viewer, docs:write / docs:publish → editor.

import { AppError } from "../shared/errors.ts";
import type { Ctx, Role } from './ctx';

/** Rank per role — higher wins. Comparison is `>=` (minimum, not exact). */
export const ROLE_RANK: Readonly<Record<Role, number>> = Object.freeze({
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
});

/** Tenancy capabilities used by the session-authenticated plane (spec §11). */
export type TenancyCapability =
  | 'docs:read'
  | 'docs:write'
  | 'docs:publish'
  | 'submissions:read'
  | 'workspace:manage'
  | 'tokens:manage'
  | 'billing:manage';

/** Capability → minimum membership role. The single source of the matrix. */
export const ROLE_MINIMUM_FOR: Readonly<Record<TenancyCapability, Role>> = Object.freeze({
  'docs:read': 'viewer',
  'submissions:read': 'viewer',
  'docs:write': 'editor',
  'docs:publish': 'editor',
  'workspace:manage': 'admin',
  'tokens:manage': 'admin',
  'billing:manage': 'owner',
});

/**
 * True when `role` meets `minimum` on the owner > admin > editor > viewer
 * ladder. A missing role (token/system actors) never satisfies — fail closed.
 */
export function roleSatisfies(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Throws FORBIDDEN when the Ctx's membership role is below `minimum`.
 * Usage in session routes: `requireRole(ctx, 'editor')` before any write.
 */
export function requireRole(ctx: Ctx, minimum: Role): void {
  if (roleSatisfies(ctx.role, minimum)) return;
  const actorNote =
    ctx.actor.kind === 'token'
      ? `API tokens are authorized by scopes (requireScope), not membership roles — required: "${minimum}".`
      : `Required role "${minimum}" or higher; your session has ${ctx.role ? `"${ctx.role}"` : 'no membership role'}.`;
  throw AppError.forbidden(`This action requires the "${minimum}" role.`, [
    { path: 'role', message: actorNote },
  ]);
}

/** Capability-based variant: `requireRoleFor(ctx, 'docs:write')`. */
export function requireRoleFor(ctx: Ctx, capability: TenancyCapability): void {
  requireRole(ctx, ROLE_MINIMUM_FOR[capability]);
}
