// T29 (spec §17): staff identity helpers for the ops plane (admin takedown).
//
// FormForge has no platform-admin membership role (roles are workspace-scoped
// by design — packages/core/src/api/roles.ts), so staff access uses a dedicated
// ops key: the `x-admin-key` header must equal the ADMIN_API_KEY env (48+
// random bytes recommended). Comparison is constant-time; unset env fails
// closed. The key never appears in logs (secrets audit, spec §17).
import { timingSafeEqual } from "node:crypto";
import { makeCtx, type Ctx } from "@formforge/core/api";

/** Constant-time staff-key check; false when ADMIN_API_KEY is unset/short. */
export function isStaffKeyValid(presented: string | null): boolean {
  const expected = process.env["ADMIN_API_KEY"] ?? "";
  if (expected.length < 24 || presented === null || presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** API Ctx for a staff action (system actor on the document's workspace). */
export function staffCtx(workspaceId: string): Ctx {
  return makeCtx({
    workspaceId,
    actor: { kind: "system" },
    requestId: crypto.randomUUID(),
    now: () => new Date(),
  });
}
