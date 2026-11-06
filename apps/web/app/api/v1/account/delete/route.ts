// T29 (spec §17 GDPR) — DELETE /api/v1/account
//
// "Account deletion" (right to erasure): deletes the user row, all sessions,
// auth tokens and memberships; sole-owned workspaces are scheduled for
// deletion (grace window, then hard purge by the maintenance job). Workspaces
// with other owners keep running — the user simply leaves them.
//
// Session-only by construction (there is no token that can act on behalf of a
// user account). The session cookie is invalidated implicitly: sessions are
// deleted server-side, so the next request fails session validation.
import { AppError } from "@formforge/core/api";
import { authenticate } from "../../_lib/auth";
import { handleApiError, ok } from "../../_lib/respond";
import { deleteAccountForSession } from "@/lib/gdpr/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: false });
    if (ctx.actor.kind !== "session") {
      return handleApiError(new AppError("FORBIDDEN", "Account deletion is session-only"));
    }

    const result = await deleteAccountForSession(ctx.actor.userId);
    if (!result.ok) return handleApiError(result.error);
    return ok(result.value, { "cache-control": "no-store" });
  } catch (error) {
    return handleApiError(error);
  }
}
