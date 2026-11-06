// T29 (spec §17 GDPR) — DELETE /api/v1/workspace
//
// "Workspace deletion" — phase 1 of two: the workspace is marked deleted
// (`deleted_at` = now) and enters the grace window (default 30 days,
// GDPR_WORKSPACE_GRACE_DAYS). The maintenance job hard-purges everything
// (documents, versions, snapshots, submissions + answers, webhooks, tokens,
// memberships, exports, the workspace row) once the window elapses —
// "deleted data purged within the retention window".
//
// OWNER-only (the most destructive workspace action; `workspace:manage` maps
// to admin, deletion goes one step up). Session-only — a stolen API token must
// not be able to erase a tenant in one call.
import { AppError, requireRoleFor } from "@formforge/core/api";
import { authenticate } from "../../_lib/auth";
import { handleApiError, ok } from "../../_lib/respond";
import { requestWorkspaceDeletionForSession } from "@/lib/gdpr/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: false });
    if (ctx.actor.kind !== "session") {
      return handleApiError(
        new AppError("FORBIDDEN", "Workspace deletion is session-only"),
      );
    }
    requireRoleFor(ctx, "workspace:manage");
    // The role matrix maps workspace:manage → admin; deletion is owner-only,
    // so tighten explicitly (admin deletes content, not the tenant itself).
    if (ctx.role !== "owner") {
      return handleApiError(
        new AppError("FORBIDDEN", "Only the workspace owner can request deletion", [
          { path: "role", message: `Your role is "${ctx.role}"; required: "owner"` },
        ]),
      );
    }

    const result = await requestWorkspaceDeletionForSession(ctx.workspaceId);
    if (!result.ok) return handleApiError(result.error);
    return ok(result.value, { "cache-control": "no-store" });
  } catch (error) {
    return handleApiError(error);
  }
}
