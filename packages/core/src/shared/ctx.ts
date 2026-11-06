// Shared kernel: Ctx — the module-contract context (spec §3).
//
// Every service function that touches tenant data requires a Ctx as its first
// argument and scopes queries by `ctx.workspaceId`. The `now` clock is always
// injected — services must never call `new Date()` themselves (spec §4, Time).

export type ActorType = "user" | "token" | "mcp" | "system";

export type Actor = {
  type: ActorType;
  id: string;
};

export type Ctx = {
  /** Tenant scope — every query in the service must be filtered by this id. */
  workspaceId: string;
  /** Who is acting. `system` is reserved for background jobs and seeds. */
  actor: Actor;
  /** Correlation id, threaded into logs (spec §4, Logging). */
  requestId: string;
  /** Injected clock. Services use `ctx.now()`, never `new Date()`. */
  now: () => Date;
};

/**
 * Convenience factory for background jobs, seeds and scripts that act
 * outside a request. Request-scoped code should build a Ctx from the
 * authenticated principal instead.
 */
export function systemCtx(workspaceId: string, requestId: string = newRequestId()): Ctx {
  return {
    workspaceId,
    actor: { type: "system", id: "system" },
    requestId,
    now: () => new Date(),
  };
}

/** Test/dev helper: build a Ctx with explicit overrides and a real clock. */
export function createCtx(overrides: Partial<Omit<Ctx, "now">> & { now?: () => Date } = {}): Ctx {
  return {
    workspaceId: overrides.workspaceId ?? "00000000-0000-7000-8000-000000000000",
    actor: overrides.actor ?? { type: "system", id: "system" },
    requestId: overrides.requestId ?? newRequestId(),
    now: overrides.now ?? (() => new Date()),
  };
}

// Local request-id generator keeps the Ctx module dependency-free; ids.ts
// lives next door but importing it here would be a layering smell for a
// correlation id whose format is unimportant.
function newRequestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
