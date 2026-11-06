// T29 (spec §17): staff takedown — "admin takedown that sets a document to
// `archived` and purges cache".
//
// AUTH: see lib/security/staff.ts — `x-admin-key` must equal ADMIN_API_KEY;
// fail closed when unset. The key never appears in logs (secrets audit, §17).
//
// TENANCY: the request must carry BOTH the documentId (path) and its
// workspaceId (body) — the takedown service runs through the workspace-scoped
// repository seam, so RLS and tenant isolation stay intact. Staff resolve the
// workspace id from the abuse report / ops runbook, not by unscoped queries.
//
// EFFECT: status → 'archived' (terminal), published_version_id cleared, stored
// snapshot deleted, CDN tag + route/snapshot keys purged (idempotent — safe to
// repeat for cache hygiene on an already-archived document).
import { handleApiError, jsonError, ok } from "@/app/api/v1/_lib/respond";
import { documentsApi } from "@/lib/api/documents";
import { isStaffKeyValid, isUuid, staffCtx } from "@/lib/security/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isStaffKeyValid(req.headers.get("x-admin-key"))) {
    // §4 has no 401; refusal is FORBIDDEN (403) — same as failed auth.
    return jsonError("FORBIDDEN", "Staff key required", [
      { path: "x-admin-key", message: "Provide the ops key in the x-admin-key header" },
    ]);
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError("VALIDATION", "Invalid document id", [
      { path: "id", message: "must be a uuid" },
    ]);
  }
  let workspaceId: string;
  try {
    const body = (await req.json()) as { workspaceId?: unknown };
    workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  } catch {
    return jsonError("VALIDATION", "Invalid JSON body", [
      { path: "body", message: "expected { workspaceId }" },
    ]);
  }
  if (!isUuid(workspaceId)) {
    return jsonError("VALIDATION", "Invalid workspaceId", [
      { path: "workspaceId", message: "must be a uuid" },
    ]);
  }

  try {
    const result = await documentsApi.takedownDocument(staffCtx(workspaceId), id);
    if (!result.ok) return handleApiError(result.error);
    // Audit line for the ops trail — no secrets, no PII (spec §4 logging rules).
    console.info(
      JSON.stringify({
        level: "info",
        event: "staff.takedown",
        documentId: id,
        workspaceId,
        alreadyArchived: !result.value.takedown,
        at: new Date().toISOString(),
      }),
    );
    return ok(result.value, { "cache-control": "no-store" });
  } catch (error) {
    return handleApiError(error);
  }
}
