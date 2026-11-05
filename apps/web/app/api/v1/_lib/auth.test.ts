// Unit tests for the /api/v1 _lib helpers (issue #25).

import { describe, expect, it, vi } from 'vitest';
import { AppError, hashToken, type ApiTokenRecord, type ApiTokenStore } from '@formforge/core/api';
import { CreateTokenRequestSchema } from '@formforge/schema/api';
import { authenticate, extractBearer } from './auth';
import { handleApiError, listResponse, ok } from './respond';
import { assertRateLimit, rateLimit, TOKEN_RATE_LIMIT_PER_MINUTE } from './rate-limit';

/* ------------------------------- fakes ------------------------------------ */

function makeStore(overrides: Partial<ApiTokenStore> = {}): ApiTokenStore & { calls: string[] } {
  const calls: string[] = [];
  const record: ApiTokenRecord = {
    id: '018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f70',
    workspaceId: 'ws_1',
    name: 'test',
    tokenHash: 'h',
    scopes: ['docs:read'],
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  return {
    calls,
    async create(input) {
      calls.push('create');
      return { ...record, tokenHash: input.tokenHash, scopes: [...input.scopes] };
    },
    async list() {
      calls.push('list');
      return [record];
    },
    async findByTokenHash(tokenHash) {
      calls.push(`find:${tokenHash.slice(0, 6)}`);
      return tokenHash === 'valid-hash' ? { ...record, tokenHash } : null;
    },
    async delete() {
      calls.push('delete');
      return true;
    },
    async touch(id) {
      calls.push(`touch:${id}`);
    },
    ...overrides,
  };
}

const req = (headers: Record<string, string> = {}) => new Request('https://x.test/api/v1/documents', { headers });

/* ------------------------------- auth ------------------------------------- */

describe('extractBearer', () => {
  it('extracts ff_ tokens, case-insensitively, rejecting junk', () => {
    const token = `ff_${'ab'.repeat(32)}`;
    expect(extractBearer(`Bearer ${token}`)).toBe(token);
    expect(extractBearer(`bearer ${token}`)).toBe(token);
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });
});

describe('authenticate (bearer path)', () => {
  const PLAINTEXT = `ff_${'ab'.repeat(32)}`;
  const good = { authorization: `Bearer ${PLAINTEXT}` };

  it('resolves a token to a token Ctx in the token workspace and touches last_used_at', async () => {
    const store = makeStore({
      findByTokenHash: async (hash) =>
        hash === hashToken(PLAINTEXT)
          ? {
              id: 'tok-1',
              workspaceId: 'ws_1',
              name: 't',
              tokenHash: hash,
              scopes: ['docs:read', 'docs:write'],
              lastUsedAt: null,
              createdAt: new Date(),
            }
          : null,
    });
    const ctx = await authenticate(req(good), { store, now: () => new Date('2026-02-02T00:00:00Z') });
    expect(ctx.workspaceId).toBe('ws_1');
    expect(ctx.actor.kind).toBe('token');
    expect(ctx.scopes).toEqual(['docs:read', 'docs:write']);
    expect(store.calls.some((c) => c.startsWith('touch:tok-1'))).toBe(true);
  });

  it('FORBIDDEN for an unknown token, a malformed header, and no credentials', async () => {
    const store = makeStore();
    await expect(authenticate(req({ authorization: 'Bearer bogus' }), { store })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(authenticate(req(), { store })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authenticate(req({ authorization: 'Basic xyz' }), { store })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('FORBIDDEN when a token hits a session-only route (token management)', async () => {
    const store = makeStore();
    await expect(authenticate(req(good), { store, allowToken: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('session'),
    });
  });
});

/* ------------------------------ respond ----------------------------------- */

describe('handleApiError (§4 mapping)', () => {
  it('maps AppError codes to HTTP statuses and keeps details', async () => {
    const res = handleApiError(
      AppError.validation('Invalid input', [{ path: 'name', message: 'Required' }]),
      { requestId: 'r1' },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details).toEqual([{ path: 'name', message: 'Required' }]);
  });

  it('maps FORBIDDEN scope errors to 403', async () => {
    const res = handleApiError(AppError.forbidden('Missing required scope: docs:write'));
    expect(res.status).toBe(403);
  });

  it('maps Zod-like errors to 422 VALIDATION with dotted paths', async () => {
    const parsed = CreateTokenRequestSchema.safeParse({ name: '', scopes: [] });
    expect(parsed.success).toBe(false);
    const res = handleApiError(parsed.error, { requestId: 'r2' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details?.every((d) => typeof d.path === 'string')).toBe(true);
  });

  it('maps unknown errors to 500 INTERNAL without leaking the message', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = handleApiError(new Error('password=secret'), { requestId: 'r3' });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INTERNAL');
      expect(body.error.message).toBe('Internal error');
      expect(JSON.stringify(body)).not.toContain('secret');
      // structured JSON log happened server-side (requestId attached)
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(String(logSpy.mock.calls[0]?.[0])).toContain('"requestId":"r3"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('shapes successful and paginated responses per §4', async () => {
    expect(ok({ a: 1 }).status).toBe(200);
    expect(listResponse(['x'], null).status).toBe(200);
    const list = await listResponse([1, 2], 'c2').json() as { data: number[]; nextCursor: string | null };
    expect(list).toEqual({ data: [1, 2], nextCursor: 'c2' });
  });
});

/* ----------------------------- rate limit --------------------------------- */

describe('rate limiting (600/min per token)', () => {
  it('allows under the limit and blocks at it, with retryAfter', () => {
    let t = 0;
    const clock = () => (t += 10); // 600 calls ≈ 6s — all inside the window
    const key = 'token:t1';
    for (let i = 0; i < TOKEN_RATE_LIMIT_PER_MINUTE; i++) {
      expect(rateLimit(key, TOKEN_RATE_LIMIT_PER_MINUTE, clock).allowed).toBe(true);
    }
    const blocked = rateLimit(key, TOKEN_RATE_LIMIT_PER_MINUTE, clock);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(() => assertRateLimit(key, TOKEN_RATE_LIMIT_PER_MINUTE, clock)).toThrowError(AppError);
  });

  it('recovers after the window passes', () => {
    let t = 0;
    const clock = () => (t += 10);
    const key = 'token:t2';
    for (let i = 0; i < TOKEN_RATE_LIMIT_PER_MINUTE; i++) rateLimit(key, TOKEN_RATE_LIMIT_PER_MINUTE, clock);
    expect(rateLimit(key, TOKEN_RATE_LIMIT_PER_MINUTE, clock).allowed).toBe(false);
    t += 61_000; // past the window
    expect(rateLimit(key, TOKEN_RATE_LIMIT_PER_MINUTE, clock).allowed).toBe(true);
  });

  it('keys are independent (per token / per session)', () => {
    let t = 0;
    const clock = () => (t += 10);
    rateLimit('token:a', 2, clock);
    rateLimit('token:a', 2, clock);
    expect(rateLimit('token:a', 2, clock).allowed).toBe(false);
    expect(rateLimit('token:b', 2, clock).allowed).toBe(true);
    expect(rateLimit('session:u1', 2, clock).allowed).toBe(true);
  });
});
