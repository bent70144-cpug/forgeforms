// API token service (issue #25, spec §6/§11).
//
// Invariants:
//  - Plaintext format is exactly `ff_` + 32 bytes hex (64 hex chars).
//  - ONLY the SHA-256 hex hash of the plaintext is ever persisted. Plaintext is
//    returned once from `createToken` and never stored, logged or derived again.
//  - Revocation deletes the row (spec §6 has no revoked_at column; spec §11
//    exposes DELETE /tokens). A revoked token fails lookup → 401 upstream.
//  - All persistence goes through the `ApiTokenStore` port so the service is
//    storage-agnostic (Drizzle impl in @formforge/db, in-memory impl in tests).

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError } from "../shared/errors.ts";
import type { Ctx } from './ctx';
import { API_SCOPES, isApiScope, type ApiScope } from './scopes';

/** A persisted token row. `tokenHash` must never leave the service layer. */
export interface ApiTokenRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly scopes: readonly ApiScope[];
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

/** Token as exposed by the API — hash stripped, plaintext never included. */
export interface ApiTokenDto {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly ApiScope[];
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface CreateTokenInput {
  readonly name: string;
  readonly scopes: readonly string[];
}

/** The one-time response of token creation: plaintext + public metadata. */
export interface CreatedToken {
  /** Plaintext `ff_…` — show exactly once, then it is gone forever. */
  readonly token: string;
  readonly record: ApiTokenDto;
}

/**
 * Storage port for API tokens. Implemented by
 * `@formforge/db/repositories/api-tokens` (Drizzle) and by fakes in tests.
 */
export interface ApiTokenStore {
  create(input: {
    id: string;
    workspaceId: string;
    name: string;
    tokenHash: string;
    scopes: readonly ApiScope[];
    createdAt: Date;
  }): Promise<ApiTokenRecord>;
  list(workspaceId: string): Promise<readonly ApiTokenRecord[]>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  delete(workspaceId: string, id: string): Promise<boolean>;
  /** Update `last_used_at` on successful bearer authentication. */
  touch(id: string, at: Date): Promise<void>;
}

export const TOKEN_NAME_MIN = 1;
export const TOKEN_NAME_MAX = 100;

/** `ff_<32 hex>` — 24 bits of "ff" prefix + 32 random bytes, hex-encoded. */
export function generateToken(): string {
  return `ff_${randomBytes(32).toString('hex')}`;
}

export function isTokenFormat(plain: string): boolean {
  return /^ff_[0-9a-f]{64}$/.test(plain);
}

/** SHA-256 hex of the plaintext. This (and only this) gets persisted. */
export function hashToken(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/** Strip the hash — the only shape that may cross into API responses. */
export function toDto(record: ApiTokenRecord): ApiTokenDto {
  return {
    id: record.id,
    name: record.name,
    scopes: [...record.scopes],
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

function validateCreateInput(input: CreateTokenInput): ApiScope[] {
  const name = input.name.trim();
  if (name.length < TOKEN_NAME_MIN || name.length > TOKEN_NAME_MAX) {
    throw AppError.validation(`Token name must be ${TOKEN_NAME_MIN}-${TOKEN_NAME_MAX} characters`, [
      { path: 'name', message: `Must be ${TOKEN_NAME_MIN}-${TOKEN_NAME_MAX} characters` },
    ]);
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw AppError.validation('At least one scope is required', [
      { path: 'scopes', message: `Must be a non-empty subset of ${API_SCOPES.join(', ')}` },
    ]);
  }
  const unique = [...new Set(input.scopes)];
  const unknown = unique.filter((s) => !isApiScope(s));
  if (unknown.length > 0) {
    throw AppError.validation(`Unknown scope(s): ${unknown.join(', ')}`, [
      { path: 'scopes', message: `Allowed scopes: ${API_SCOPES.join(', ')}` },
    ]);
  }
  return unique as ApiScope[];
}

/**
 * Create a token. Returns the plaintext exactly once.
 * // INTEGRATION-DEBT: id is uuid v4 until T02 lands shared/ids.ts uuidv7 (spec §4).
 */
export async function createToken(
  ctx: Ctx,
  store: ApiTokenStore,
  input: CreateTokenInput,
): Promise<CreatedToken> {
  const scopes = validateCreateInput(input);
  const name = input.name.trim();
  const plaintext = generateToken();
  const record = await store.create({
    // INTEGRATION-DEBT: awaiting T02 — replace with uuidv7() from shared/ids.ts
    id: randomUUID(),
    workspaceId: ctx.workspaceId,
    name,
    tokenHash: hashToken(plaintext),
    scopes,
    createdAt: ctx.now(),
  });
  return { token: plaintext, record: toDto(record) };
}

/** List the workspace's tokens (hash-free DTOs), oldest first. */
export async function listTokens(ctx: Ctx, store: ApiTokenStore): Promise<readonly ApiTokenDto[]> {
  const records = await store.list(ctx.workspaceId);
  return records
    .map(toDto)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Revoke (delete) a token owned by the caller's workspace.
 * Throws NOT_FOUND when the id does not exist in this workspace.
 */
export async function revokeToken(ctx: Ctx, store: ApiTokenStore, tokenId: string): Promise<void> {
  const deleted = await store.delete(ctx.workspaceId, tokenId);
  if (!deleted) {
    throw AppError.notFound('Token not found');
  }
}

export type VerifiedToken = Pick<ApiTokenRecord, 'id' | 'workspaceId' | 'scopes'>;

/**
 * Bearer-path verification: hash the presented plaintext, look up the hash.
 * Anything malformed, unknown or revoked is FORBIDDEN (403) — spec §4 defines
 * no separate 401 code for the v1 API.
 * The caller is responsible for touching `last_used_at` (see `touchToken`).
 */
export async function verifyToken(
  store: ApiTokenStore,
  plaintext: string,
): Promise<VerifiedToken> {
  if (!isTokenFormat(plaintext)) {
    throw AppError.forbidden('Invalid API token');
  }
  const record = await store.findByTokenHash(hashToken(plaintext));
  if (!record) {
    // Unknown or already-revoked token — indistinguishable on purpose.
    throw AppError.forbidden('Invalid API token');
  }
  return { id: record.id, workspaceId: record.workspaceId, scopes: record.scopes };
}

/** Record usage after a successful authenticated request (best-effort). */
export async function touchToken(store: ApiTokenStore, tokenId: string, at: Date): Promise<void> {
  await store.touch(tokenId, at);
}
