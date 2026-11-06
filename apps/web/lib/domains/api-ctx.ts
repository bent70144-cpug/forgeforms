// apps/web/lib/domains/api-ctx.ts
// Adapter: the /api/v1 auth plane Ctx (core/api — AuthActor with
// session/token kinds, scopes) onto the module-contract Ctx (spec §3,
// Actor {type, id}) that core services consume. Route handlers call this
// before handing the context to the domains service so the service stays
// free of API-plane types (spec §3: services take the kernel Ctx).
import type { Ctx as ApiCtx } from '@formforge/core/api';
import type { Ctx } from '@formforge/core';

export function toServiceCtx(ctx: ApiCtx): Ctx {
  const actor = (() => {
    switch (ctx.actor.kind) {
      case 'session':
        return { type: 'user' as const, id: ctx.actor.userId };
      case 'token':
        return { type: 'token' as const, id: ctx.actor.tokenId };
      case 'system':
        return { type: 'system' as const, id: 'system' };
    }
  })();
  return {
    workspaceId: ctx.workspaceId,
    actor,
    requestId: ctx.requestId,
    now: () => ctx.now(),
  };
}
