// Sample service — the reference implementation of the module contract
// (spec §3/§4). Kept deliberately small: later tickets copy this shape.
//
// Demonstrates the three rules the contract cares about:
//   1. takes `Ctx` first and scopes by `ctx.workspaceId`;
//   2. reads time only through the injected `ctx.now()` clock (no `new Date()`
//      inside the service — testable with a frozen clock);
//   3. returns/produces plain data the caller can wrap in Result<T, AppError>.

import type { Ctx } from "./ctx.js";
import { uuidv7 } from "./ids.js";

/** Mirrors the `audit_log` table (spec §6). */
export type AuditEntry = {
  id: string;
  workspace_id: string;
  actor_type: Ctx["actor"]["type"];
  actor_id: string;
  action: string;
  target: string | null;
  created_at: Date;
};

/**
 * Build an audit entry for an action performed in the current context.
 * Pure with respect to `ctx`: same ctx (frozen clock) → same output.
 */
export function buildAuditEntry(ctx: Ctx, action: string, target?: string): AuditEntry {
  return {
    // Timestamp the id with the injected clock so ids and rows agree on time.
    id: uuidv7(ctx.now().getTime()),
    workspace_id: ctx.workspaceId,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action,
    target: target ?? null,
    created_at: ctx.now(),
  };
}
