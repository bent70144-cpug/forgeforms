// T19 — server-side data loader for the Analytics tab (spec §14.1.5).
// Server-only: builds the analytics service over the default repository.
// Degrades gracefully (null) when DATABASE_URL is absent or the DB is down so
// the tab renders its actionable empty state instead of crashing.
import {
  createAnalyticsService,
  openAdvancedAnalyticsGate,
  type AnalyticsSummary,
  type RangeSpec,
} from "../../../../../../../../packages/core/src/analytics";
import { getDefaultAnalyticsRepository } from "../../../../../../../../packages/db/src/repositories/analytics";

export interface DropOffResult {
  enabled: boolean;
  steps: Array<{ blockId: string; views: number; passes: number; passRate: number; dropOffRate: number }>;
}

export interface AnalyticsTabData {
  summary: AnalyticsSummary;
  dropOff: DropOffResult | null;
}

export async function loadAnalyticsTabData(docId: string, spec: RangeSpec): Promise<AnalyticsTabData | null> {
  const repo = getDefaultAnalyticsRepository();
  if (!repo) return null;
  try {
    const service = createAnalyticsService({
      repo,
      // INTEGRATION-DEBT: analytics plane is system-scoped until T03/T04 wire
      // the session ctx through the dashboard; docId-scoped reads are enforced
      // by the repository layer.
      ctx: {
        workspaceId: "system",
        actor: { type: "system", id: "analytics" },
        requestId: "analytics-tab-" + docId,
        now: () => new Date(),
      },
    });
    const summary = await service.getAnalytics(docId, spec);
    // INTEGRATION-DEBT: wire the real workspace + billing.can() once T05 (auth)
    // and T23 (billing) land; the open stub keeps drop-off visible meanwhile.
    const dropOff = await service.getDropOff(docId, spec, {
      workspaceId: docId,
      can: openAdvancedAnalyticsGate,
    });
    return { summary, dropOff };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "analytics tab load failed",
        documentId: docId,
        error: String(error),
      }),
    );
    return null;
  }
}
