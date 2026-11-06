// @formforge/core — API token module (issue #25).
// Public interface of `core/api`; consumers (web routes, other tickets) must
// import only from here, never internals (spec §0.5).

export { AppError } from "../shared/errors.ts";
export { err, ok } from "../shared/result.ts";
export { makeCtx } from './ctx';
export { toHttpStatus, toHttpStatus as httpStatusFor } from '../shared/errors.ts';
export type { AuthActor, Ctx, Role } from './ctx';
export type { AppErrorCode as ErrorCode } from '../shared/errors.ts';
export type { Result } from '../shared/result.ts';

export { API_SCOPES, hasScope, isApiScope, requireScope } from './scopes';
export type { ApiScope } from './scopes';

// T04 (issue #4): tenancy role matrix + requireRole.
export {
  ROLE_MINIMUM_FOR,
  ROLE_RANK,
  requireRole,
  requireRoleFor,
  roleSatisfies,
} from './roles';
export type { TenancyCapability } from './roles';

export {
  TOKEN_NAME_MAX,
  TOKEN_NAME_MIN,
  createToken,
  generateToken,
  hashToken,
  isTokenFormat,
  listTokens,
  revokeToken,
  toDto,
  touchToken,
  verifyToken,
} from './tokens';
export type {
  ApiTokenDto,
  ApiTokenStore,
  ApiTokenRecord,
  CreateTokenInput,
  CreatedToken,
  VerifiedToken,
} from './tokens';
