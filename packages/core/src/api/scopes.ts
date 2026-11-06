// API token scopes (spec §6 `api_tokens.scopes`, issue #25).
// Scope names are part of the public API contract — T26/T27 and the OpenAPI
// document in @formforge/schema/api all reference these exact strings.

import { AppError } from "../shared/errors.ts";;

/** The complete set of grantable scopes. Exact strings, never renamed casually. */
export const API_SCOPES = [
  'docs:read',
  'docs:write',
  'docs:publish',
  'submissions:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/**
 * Scope check for a request. Matching is EXACT — `docs:write` does not imply
 * `docs:read`; every spec §11 endpoint declares precisely one scope.
 */
export function hasScope(scopes: readonly string[], required: ApiScope): boolean {
  return scopes.includes(required);
}

/**
 * Throws FORBIDDEN (403) when the actor's scopes do not include `required`.
 * Used by every `/api/v1` route: `requireScope(ctx.scopes, 'docs:write')`.
 * Session actors carry `[]` scopes and are authorized by role (T04) upstream;
 * system actors are internal only.
 */
export function requireScope(scopes: readonly string[], required: ApiScope): void {
  if (!hasScope(scopes, required)) {
    throw AppError.forbidden(`Missing required scope: ${required}`, [
      { path: 'scopes', message: `This credential requires scope "${required}".` },
    ]);
  }
}
