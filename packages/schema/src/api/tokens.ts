// API token management schemas (issue #25, spec §11 "GET/POST/DELETE /tokens —
// session only"). These are also the Zod source for the OpenAPI document.
//
// SECURITY: the plaintext token appears in exactly ONE response type —
// CreateTokenResponseSchema — and only for the POST that created it. It is
// never listed, never patched, never logged.
import { z } from 'zod';

/** Mirror of core `API_SCOPES` — kept in lockstep by openapi.test.ts parity check. */
export const API_SCOPES = ['docs:read', 'docs:write', 'docs:publish', 'submissions:read'] as const;

export const ApiScopeSchema = z.enum(API_SCOPES);

export const CreateTokenRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  scopes: z.array(ApiScopeSchema).min(1, 'At least one scope is required').max(API_SCOPES.length),
});
export type CreateTokenRequest = z.infer<typeof CreateTokenRequestSchema>;

/** Public token metadata — no hash, no plaintext. */
export const TokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100),
  scopes: z.array(ApiScopeSchema).min(1),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Token = z.infer<typeof TokenSchema>;

/**
 * POST /api/v1/tokens response. `token` is the plaintext `ff_<32 hex>` shown
 * EXACTLY ONCE (reveal-once enforced client-side: shown in a modal, then the
 * value is dropped from memory — the server stores only its SHA-256 hash).
 */
export const CreateTokenResponseSchema = TokenSchema.extend({
  token: z.string().regex(/^ff_[0-9a-f]{64}$/, 'Plaintext token, ff_ + 32 hex bytes'),
});
export type CreateTokenResponse = z.infer<typeof CreateTokenResponseSchema>;

/** Token lists are small (per workspace) — same envelope shape, no cursor. */
export const ListTokensResponseSchema = z.object({
  data: z.array(TokenSchema),
  nextCursor: z.null(),
});

export const RevokeTokenRequestSchema = z.object({
  id: z.string().uuid(),
});
