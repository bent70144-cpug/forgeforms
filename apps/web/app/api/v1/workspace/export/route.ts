// T29 (spec §17 GDPR) — GET /api/v1/workspace/export
//
// "Workspace data export" (right of access / data portability). SESSION-ONLY
// (spec §11: workspace routes need a human in the loop; API tokens are
// workspace-bound service credentials and must not be able to exfiltrate the
// full archive unattended).
//
// Response: `application/json` attachment (`formforge-export-<slug>.json`) —
// the §17 archive shape from @formforge/core/gdpr (workspace, members,
// documents + versions, submissions + answers, webhook endpoints WITHOUT
// secrets, API tokens WITHOUT hashes). `cache-control: no-store` — an export
// is never cacheable/proxyable.
import { authenticate } from "../../_lib/auth";
import { handleApiError } from "../../_lib/respond";
import { exportWorkspaceForSession } from "@/lib/gdpr/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: false });
    if (ctx.actor.kind !== "session") {
      return handleApiError(
        new (await import("@formforge/core")).AppError(
          "FORBIDDEN",
          "Workspace export is session-only",
        ),
      );
    }

    const result = await exportWorkspaceForSession(ctx.workspaceId);
    if (!result.ok) return handleApiError(result.error);

    const filename = `formforge-export-${ctx.workspaceId}.json`;
    return new Response(JSON.stringify(result.value, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
