// Unit tests for the /api/v1 _lib helpers (issue #25, T07 session path).

import { describe, expect, it, vi } from 'vitest';
import { AppError, hashToken, type ApiTokenRecord, type ApiTokenStore } from '@formforge/core/api';
import type { AuthenticatedSession } from '@formforge/core/identity';
import { CreateTokenRequestSchema } from '@formforge/schema/api';
import { authenticate, extractBearer, scopesForRole, type SessionLoader } from './auth';
import { handleApiError, listResponse, ok } from './respond';
import { assertRateLimit, rateLimit, SESSION_RATE_LIMIT_PER_MINUTE, TOKEN_RATE_LIMIT_PER_MINUTE } from './rate-limit';

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

/* --------------------- authenticate (session path, T07) -------------------- */

function makeSession(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  return {
    session: {
      id: 'sess-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date('2026-12-31T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    user: {
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      passwordHash: null,
      emailVerifiedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    workspace: {
      id: 'ws_1',
      name: 'Ada Inc',
      slug: 'ada-inc',
      plan: 'free',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    role: 'owner',
    ...overrides,
  } as AuthenticatedSession;
}

describe('scopesForRole (role → §11 scope map)', () => {
  it('owner/admin/editor get the full document scope set', () => {
    for (const role of ['owner', 'admin', 'editor'] as const) {
      expect(scopesForRole(role)).toEqual([
        'docs:read',
        'docs:write',
        'docs:publish',
        'submissions:read',
      ]);
    }
  });

  it('viewer and unknown roles are read-only', () => {
    expect(scopesForRole('viewer')).toEqual(['docs:read', 'submissions:read']);
    expect(scopesForRole(null)).toEqual(['docs:read', 'submissions:read']);
  });
});

describe('authenticate (session path)', () => {
  const loader = (session: AuthenticatedSession | null, throws = false): SessionLoader =>
    vi.fn(async () => {
      if (throws) throw new Error('cookies() outside request scope');
      return session;
    });

  it('resolves the active workspace + role-scoped scopes from the session', async () => {
    const load = loader(makeSession());
    const ctx = await authenticate(req(), { sessionLoader: load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(ctx.workspaceId).toBe('ws_1');
    expect(ctx.actor).toMatchObject({ kind: 'session', userId: 'user-1', role: 'owner' });
    expect(ctx.scopes).toContain('docs:write');
    expect(ctx.scopes).toContain('docs:publish');
  });

  it('viewer sessions cannot write or publish', async () => {
    const ctx = await authenticate(req(), { sessionLoader: loader(makeSession({ role: 'viewer' })) });
    expect(ctx.scopes).toEqual(['docs:read', 'submissions:read']);
  });

  it('FORBIDDEN (403, never 500) when there is no session or resolution fails', async () => {
    await expect(authenticate(req(), { sessionLoader: loader(null) })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // e.g. next/headers cookies() outside a request scope, DB down, …
    await expect(authenticate(req(), { sessionLoader: loader(null, true) })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('FORBIDDEN when the session has no active workspace (documents are workspace-scoped)', async () => {
    const noWorkspace = makeSession({ workspace: null });
    await expect(authenticate(req(), { sessionLoader: loader(noWorkspace) })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('workspace'),
    });
  });

  it('a bearer token wins over the session cookie (explicit credential)', async () => {
    const store = makeStore({
      findByTokenHash: async (hash) =>
        hash === hashToken(`ff_${'ab'.repeat(32)}`)
          ? {
              id: 'tok-9',
              workspaceId: 'ws_token',
              name: 't',
              tokenHash: hash,
              scopes: ['docs:read'],
              lastUsedAt: null,
              createdAt: new Date(),
            }
          : null,
    });
    const load = loader(makeSession());
    const ctx = await authenticate(req({ authorization: `Bearer ff_${'ab'.repeat(32)}` }), {
      store,
      sessionLoader: load,
    });
    expect(load).not.toHaveBeenCalled();
    expect(ctx.workspaceId).toBe('ws_token');
  });

  it('rate-limits the session credential at 300/min (spec §11)', () => {
    let t = 0;
    const clock = () => (t += 10);
    const key = 'session:u9';
    for (let i = 0; i < SESSION_RATE_LIMIT_PER_MINUTE; i++) {
      expect(rateLimit(key, SESSION_RATE_LIMIT_PER_MINUTE, clock).allowed).toBe(true);
    }
    expect(rateLimit(key, SESSION_RATE_LIMIT_PER_MINUTE, clock).allowed).toBe(false);
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
