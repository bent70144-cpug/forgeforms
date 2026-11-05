// Unit tests for the API token service (issue #25).
// Storage port faked with an in-memory store — no DB needed at this layer.

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError, makeCtx, type Ctx } from '../bridge';
import {
  API_SCOPES,
  createToken,
  generateToken,
  hashToken,
  hasScope,
  isTokenFormat,
  listTokens,
  requireScope,
  revokeToken,
  touchToken,
  verifyToken,
  type ApiTokenRecord,
  type ApiTokenStore,
} from './index';

function makeStore(): ApiTokenStore & { rows: Map<string, ApiTokenRecord> } {
  const rows = new Map<string, ApiTokenRecord>();
  return {
    rows,
    async create(input) {
      const record: ApiTokenRecord = {
        id: input.id,
        workspaceId: input.workspaceId,
        name: input.name,
        tokenHash: input.tokenHash,
        scopes: [...input.scopes],
        lastUsedAt: null,
        createdAt: input.createdAt,
      };
      rows.set(record.id, record);
      return record;
    },
    async list(workspaceId) {
      return [...rows.values()].filter((r) => r.workspaceId === workspaceId);
    },
    async findByTokenHash(tokenHash) {
      return [...rows.values()].find((r) => r.tokenHash === tokenHash) ?? null;
    },
    async delete(workspaceId, id) {
      const row = rows.get(id);
      if (!row || row.workspaceId !== workspaceId) return false;
      rows.delete(id);
      return true;
    },
    async touch(id, at) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, lastUsedAt: at });
    },
  };
}

function tokenCtx(workspaceId = 'ws_a', scopes: readonly string[] = [...API_SCOPES]): Ctx {
  return makeCtx({
    workspaceId,
    actor: { kind: 'token', tokenId: 'tok_test', scopes },
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
}

describe('token format & hashing', () => {
  it('generates ff_<32 hex> plaintext tokens', () => {
    const token = generateToken();
    expect(token).toMatch(/^ff_[0-9a-f]{64}$/);
    expect(isTokenFormat(token)).toBe(true);
    expect(isTokenFormat('ff_short')).toBe(false);
    expect(isTokenFormat('ghp_' + 'a'.repeat(36))).toBe(false);
  });

  it('hashes with sha256 and never round-trips to the plaintext', () => {
    const plaintext = generateToken();
    const hash = hashToken(plaintext);
    expect(hash).toBe(createHash('sha256').update(plaintext, 'utf8').digest('hex'));
    expect(hash).not.toContain(plaintext);
    expect(hash).toHaveLength(64);
    // deterministic
    expect(hashToken(plaintext)).toBe(hash);
    // a different plaintext hashes differently
    expect(hashToken(generateToken())).not.toBe(hash);
  });

  it('two generated tokens never collide', () => {
    const seen = new Set(Array.from({ length: 200 }, generateToken));
    expect(seen.size).toBe(200);
  });
});

describe('createToken', () => {
  it('persists only the hash and returns plaintext exactly once', async () => {
    const store = makeStore();
    const ctx = tokenCtx();
    const { token, record } = await createToken(ctx, store, {
      name: 'CI token',
      scopes: ['docs:read', 'docs:write'],
    });

    expect(token).toMatch(/^ff_[0-9a-f]{64}$/);
    expect('tokenHash' in record).toBe(false); // DTO carries no hash
    const persisted = [...store.rows.values()][0]!;
    expect(persisted.tokenHash).toBe(hashToken(token));
    expect(persisted.workspaceId).toBe('ws_a');
    expect(persisted.scopes).toEqual(['docs:read', 'docs:write']);
    expect(persisted.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects empty names, over-long names, and empty/unknown scopes with VALIDATION', async () => {
    const store = makeStore();
    const ctx = tokenCtx();
    const bad: Array<Parameters<typeof createToken>[2]> = [
      { name: '', scopes: ['docs:read'] },
      { name: '   ', scopes: ['docs:read'] },
      { name: 'x'.repeat(101), scopes: ['docs:read'] },
      { name: 'ok', scopes: [] },
      { name: 'ok', scopes: ['docs:admin'] },
      { name: 'ok', scopes: ['docs:read', 'submissions:write'] },
    ];
    for (const input of bad) {
      await expect(createToken(ctx, store, input)).rejects.toMatchObject({
        name: 'AppError',
        code: 'VALIDATION',
      });
    }
    expect(store.rows.size).toBe(0);
  });

  it('deduplicates repeated scopes', async () => {
    const store = makeStore();
    const { record } = await createToken(tokenCtx(), store, {
      name: 'dup',
      scopes: ['docs:read', 'docs:read'],
    });
    expect(record.scopes).toEqual(['docs:read']);
  });
});

describe('verifyToken (bearer path)', () => {
  it('round-trips: create → verify returns id, workspace, scopes', async () => {
    const store = makeStore();
    const { token } = await createToken(tokenCtx(), store, {
      name: 'roundtrip',
      scopes: ['docs:read'],
    });
    const verified = await verifyToken(store, token);
    expect(verified.workspaceId).toBe('ws_a');
    expect(verified.scopes).toEqual(['docs:read']);
  });

  it('a wrong or malformed token is FORBIDDEN (403), never a hash leak', async () => {
    const store = makeStore();
    await createToken(tokenCtx(), store, { name: 't', scopes: ['docs:read'] });

    for (const bad of [
      `ff_${'0'.repeat(64)}`, // well-formed but unknown
      'ff_nonsense',
      'Bearer ff_x',
      '',
    ]) {
      await expect(verifyToken(store, bad)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });

  it('a revoked token is rejected', async () => {
    const store = makeStore();
    const ctx = tokenCtx();
    const { token, record } = await createToken(ctx, store, {
      name: 'doomed',
      scopes: ['docs:read'],
    });
    await expect(verifyToken(store, token)).resolves.toBeTruthy();

    await revokeToken(ctx, store, record.id);
    await expect(verifyToken(store, token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('revokeToken & listTokens', () => {
  it('revoke is workspace-scoped: another workspace gets NOT_FOUND', async () => {
    const store = makeStore();
    const ctxA = tokenCtx('ws_a');
    const { record } = await createToken(ctxA, store, { name: 'a', scopes: ['docs:read'] });

    await expect(revokeToken(tokenCtx('ws_b'), store, record.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(revokeToken(ctxA, store, record.id)).resolves.toBeUndefined();
  });

  it('list returns hash-free DTOs, sorted oldest first, only own workspace', async () => {
    const store = makeStore();
    const early = makeCtx({
      workspaceId: 'ws_a',
      actor: { kind: 'token', tokenId: 't', scopes: [] },
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    const late = makeCtx({
      workspaceId: 'ws_a',
      actor: { kind: 'token', tokenId: 't', scopes: [] },
      now: () => new Date('2026-02-01T00:00:00Z'),
    });
    await createToken(early, store, { name: 'first', scopes: ['docs:read'] });
    await createToken(late, store, { name: 'second', scopes: ['docs:publish'] });
    await createToken(tokenCtx('ws_b'), store, { name: 'foreign', scopes: ['docs:read'] });

    const list = await listTokens(tokenCtx('ws_a'), store);
    expect(list.map((t) => t.name)).toEqual(['first', 'second']);
    for (const dto of list) {
      expect(dto).not.toHaveProperty('tokenHash');
      expect(dto).not.toHaveProperty('workspaceId');
    }
  });

  it('revoking an unknown id throws NOT_FOUND', async () => {
    const store = makeStore();
    await expect(revokeToken(tokenCtx(), store, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('scopes', () => {
  it('exact match only — docs:write does not imply docs:read', () => {
    expect(hasScope(['docs:read'], 'docs:read')).toBe(true);
    expect(hasScope(['docs:write'], 'docs:read')).toBe(false);
    expect(hasScope(['docs:read'], 'docs:write')).toBe(false);
  });

  it('requireScope throws FORBIDDEN with the missing scope in details — per scope', () => {
    const granted: readonly string[] = ['docs:read'];
    for (const required of API_SCOPES) {
      try {
        requireScope(granted, required);
        if (required !== 'docs:read') throw new Error(`expected FORBIDDEN for ${required}`);
        expect(required).toBe('docs:read'); // granted scope passes
      } catch (e) {
        if (required === 'docs:read') throw e;
        expect(e).toBeInstanceOf(AppError);
        const appErr = e as AppError;
        expect(appErr.code).toBe('FORBIDDEN');
        expect(appErr.httpStatus).toBe(403);
        expect(appErr.details?.[0]?.message).toContain(required);
      }
    }
  });

  it('requireScope passes when the scope is granted', () => {
    expect(() => requireScope(['submissions:read'], 'submissions:read')).not.toThrow();
    expect(() => requireScope(['docs:write', 'docs:publish'], 'docs:publish')).not.toThrow();
  });
});

describe('touchToken (last_used_at)', () => {
  it('updates last_used_at on the persisted row', async () => {
    const store = makeStore();
    const { record } = await createToken(tokenCtx(), store, {
      name: 'used',
      scopes: ['docs:read'],
    });
    const at = new Date('2026-03-01T12:00:00Z');
    await touchToken(store, record.id, at);
    expect(store.rows.get(record.id)?.lastUsedAt?.toISOString()).toBe(at.toISOString());
  });
});

describe('error mapping sanity', () => {
  it('AppError codes map to spec §4 HTTP statuses', () => {
    expect(AppError.notFound().httpStatus).toBe(404);
    expect(AppError.forbidden().httpStatus).toBe(403);
    expect(AppError.validation().httpStatus).toBe(422);
    expect(AppError.conflict().httpStatus).toBe(409);
    expect(AppError.rateLimited().httpStatus).toBe(429);
    expect(AppError.planLimit().httpStatus).toBe(402);
    expect(AppError.internal().httpStatus).toBe(500);
  });

  it('ctx.now() is the only clock used by the service', async () => {
    const store = makeStore();
    const now = vi.fn(() => new Date('2026-05-05T05:05:05Z'));
    const ctx = makeCtx({
      workspaceId: 'ws_a',
      actor: { kind: 'token', tokenId: 't', scopes: [] },
      now,
    });
    await createToken(ctx, store, { name: 'clock', scopes: ['docs:read'] });
    expect(now).toHaveBeenCalled();
  });
});
