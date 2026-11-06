// T25 request context for the token-authenticated API plane (spec §11).
// Lead integration note: richer than the shared kernel Ctx — carries auth-kind
// accessors (userId/role/scopes). The API module is the only consumer.
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** What authenticated the request (spec §11: session cookie OR bearer token). */
export type AuthActor =
  | { kind: 'session'; userId: string; role: Role }
  | { kind: 'token'; tokenId: string; scopes: readonly string[] }
  | { kind: 'system' };

export interface Ctx {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly actor: AuthActor;
  readonly userId: string | null;
  readonly role: Role | null;
  readonly scopes: readonly string[];
  now(): Date;
}

/** Factory for a `Ctx` in tests and simple call sites. */
export function makeCtx(input: {
  workspaceId: string;
  actor?: AuthActor;
  requestId?: string;
  now?: () => Date;
}): Ctx {
  const actor: AuthActor = input.actor ?? { kind: 'system' };
  return {
    workspaceId: input.workspaceId,
    requestId: input.requestId ?? crypto.randomUUID(),
    actor,
    userId: actor.kind === 'session' ? actor.userId : null,
    role: actor.kind === 'session' ? actor.role : null,
    scopes: actor.kind === 'token' ? actor.scopes : [],
    now: input.now ?? (() => new Date()),
  };
}
