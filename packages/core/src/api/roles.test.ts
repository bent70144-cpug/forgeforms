// Unit tests for the tenancy role matrix (T04, spec §6/§11/§21).
// Matrix under test (ticket #4):
//   viewer can read, editor writes docs, admin manages members/settings,
//   owner everything — hierarchy owner > admin > editor > viewer.
// DB-free: pure Ctx objects, no repositories.

import { describe, expect, it } from 'vitest';
import { AppError } from '../bridge';
import { makeCtx, type Ctx, type Role } from './ctx';
import {
  ROLE_MINIMUM_FOR,
  ROLE_RANK,
  roleSatisfies,
  requireRole,
  requireRoleFor,
  type TenancyCapability,
} from './roles';

function ctxWithRole(role: Role | null, kind: 'session' | 'token' | 'system' = 'session'): Ctx {
  if (kind === 'session') {
    return makeCtx({
      workspaceId: '00000000-0000-7000-8000-00000000a000',
      actor: { kind: 'session', userId: 'user-1', role: role ?? 'viewer' },
    });
  }
  if (kind === 'token') {
    return makeCtx({
      workspaceId: '00000000-0000-7000-8000-00000000a000',
      actor: { kind: 'token', tokenId: 'tok-1', scopes: [] },
    });
  }
  return makeCtx({ workspaceId: '00000000-0000-7000-8000-00000000a000' });
}

describe('roleSatisfies (hierarchy owner > admin > editor > viewer)', () => {
  it('ranks roles viewer < editor < admin < owner', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
  });

  it.each([
    ['viewer', 'viewer', true],
    ['viewer', 'editor', false],
    ['editor', 'viewer', true],
    ['editor', 'editor', true],
    ['editor', 'admin', false],
    ['admin', 'editor', true],
    ['admin', 'admin', true],
    ['admin', 'owner', false],
    ['owner', 'owner', true],
    ['owner', 'viewer', true],
  ] as const)('%s satisfies minimum %s → %s', (role, minimum, expected) => {
    expect(roleSatisfies(role, minimum)).toBe(expected);
  });

  it('a missing role (token/system actor) never satisfies', () => {
    expect(roleSatisfies(null, 'viewer')).toBe(false);
    expect(roleSatisfies(undefined, 'viewer')).toBe(false);
  });
});

describe('requireRole', () => {
  it('viewer may read (minimum viewer)', () => {
    expect(() => requireRole(ctxWithRole('viewer'), 'viewer')).not.toThrow();
  });

  it('viewer attempting a write (minimum editor) is rejected FORBIDDEN', () => {
    try {
      requireRole(ctxWithRole('viewer'), 'editor');
      expect.unreachable('requireRole must throw');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      const appError = error as AppError;
      expect(appError.code).toBe('FORBIDDEN');
      expect(appError.status).toBe(403);
      expect(appError.details).toContainEqual({
        path: 'role',
        message: expect.stringContaining('editor'),
      });
    }
  });

  it('editor may write docs but cannot manage members (minimum admin)', () => {
    expect(() => requireRole(ctxWithRole('editor'), 'editor')).not.toThrow();
    expect(() => requireRole(ctxWithRole('editor'), 'admin')).toThrow(AppError);
  });

  it('admin manages members/settings but not billing (minimum owner)', () => {
    expect(() => requireRole(ctxWithRole('admin'), 'admin')).not.toThrow();
    expect(() => requireRole(ctxWithRole('admin'), 'owner')).toThrow(AppError);
  });

  it('owner passes every level', () => {
    for (const minimum of ['viewer', 'editor', 'admin', 'owner'] as const) {
      expect(() => requireRole(ctxWithRole('owner'), minimum)).not.toThrow();
    }
  });

  it('rejects API-token and system actors (no membership role) fail-closed', () => {
    expect(() => requireRole(ctxWithRole(null, 'token'), 'viewer')).toThrow(AppError);
    expect(() => requireRole(ctxWithRole(null, 'system'), 'viewer')).toThrow(AppError);
  });
});

describe('requireRoleFor (capability matrix per spec §11 route scopes)', () => {
  it('maps read capabilities to viewer', () => {
    expect(ROLE_MINIMUM_FOR['docs:read']).toBe('viewer');
    expect(ROLE_MINIMUM_FOR['submissions:read']).toBe('viewer');
  });

  it('maps document writes and publish to editor', () => {
    expect(ROLE_MINIMUM_FOR['docs:write']).toBe('editor');
    expect(ROLE_MINIMUM_FOR['docs:publish']).toBe('editor');
  });

  it('maps members/settings/token management to admin', () => {
    expect(ROLE_MINIMUM_FOR['workspace:manage']).toBe('admin');
    expect(ROLE_MINIMUM_FOR['tokens:manage']).toBe('admin');
  });

  it('maps billing to owner', () => {
    expect(ROLE_MINIMUM_FOR['billing:manage']).toBe('owner');
  });

  it('viewer attempting docs:write is rejected FORBIDDEN (acceptance #2)', () => {
    try {
      requireRoleFor(ctxWithRole('viewer'), 'docs:write');
      expect.unreachable('requireRoleFor must throw');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
  });

  it.each([
    ['docs:read', 'viewer', true],
    ['submissions:read', 'viewer', true],
    ['docs:write', 'viewer', false],
    ['docs:publish', 'editor', true],
    ['workspace:manage', 'editor', false],
    ['workspace:manage', 'admin', true],
    ['tokens:manage', 'admin', true],
    ['billing:manage', 'owner', true],
    ['billing:manage', 'admin', false],
  ] as const)('%s for %s → %s', (capability, role, expected) => {
    const ctx = ctxWithRole(role);
    if (expected) expect(() => requireRoleFor(ctx, capability)).not.toThrow();
    else expect(() => requireRoleFor(ctx, capability)).toThrow(AppError);
  });

  it('covers every declared capability', () => {
    const capabilities: TenancyCapability[] = [
      'docs:read',
      'docs:write',
      'docs:publish',
      'submissions:read',
      'workspace:manage',
      'tokens:manage',
      'billing:manage',
    ];
    for (const capability of capabilities) {
      expect(ROLE_MINIMUM_FOR[capability]).toBeDefined();
    }
  });
});
