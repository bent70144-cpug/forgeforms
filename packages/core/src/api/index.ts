// @formforge/core — API token module (issue #25).
// Public interface of `core/api`; consumers (web routes, other tickets) must
// import only from here, never internals (spec §0.5).

export { AppError, err, ok } from '../bridge';
export { makeCtx } from './ctx';
export { httpStatusFor } from '../bridge';
export type { AuthActor, Ctx, Role } from './ctx';
export type { ErrorCode, Result } from '../bridge';

export { API_SCOPES, hasScope, isApiScope, requireScope } from './scopes';
export type { ApiScope } from './scopes';

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
