// T15 — API + view types for the Results UI.
// Shapes follow spec §11 (authenticated API) and §4 (cursor pagination):
//   GET /documents/:id/submissions  → { data: SubmissionDTO[], nextCursor: string | null }
//   GET /documents/:id/submissions/:sid → { data: SubmissionDTO }
//   GET /documents/:id/summary      → { data: SummaryResponse }
// SPEC-NOTE: `SubmissionDTO.answers` is keyed by blockId → raw answer value
// (mirrors the `answers` table in spec §6). The webhook payload enriches values
// with labels; the Results UI derives labels from the document snapshot instead.

import type { Block, DocumentBody } from "../results-bridge";

/** spec §6 — submissions.status */
export type SubmissionStatus = "draft" | "completed" | "spam";

/** UI filter values (maps onto SubmissionStatus; "all" sends no status param). */
export type StatusFilter = "all" | "completed" | "draft" | "spam";

/** Sort direction for the submissions table (server sorts by submitted_at). */
export type SortDir = "newest" | "oldest";

/** One submission row (list + detail share the shape; detail guarantees completeness). */
export interface SubmissionDTO {
  id: string;
  documentId: string;
  versionId: string;
  status: SubmissionStatus;
  publicToken: string;
  /** blockId → answer value (raw, spec §7 answer schemas). */
  answers: Record<string, unknown>;
  /** Logic variables (spec §6 — score, price, …). */
  variables: Record<string, unknown>;
  /** Hidden fields / UTM (spec §6). */
  hidden: Record<string, unknown>;
  /** Device, country, referrer — only when allowed (spec §6). */
  meta: Record<string, unknown>;
  /** ISO 8601 UTC. */
  startedAt: string;
  /** ISO 8601 UTC; null while draft. */
  completedAt: string | null;
}

/** spec §4 — cursor page envelope. */
export interface SubmissionsPage {
  data: SubmissionDTO[];
  nextCursor: string | null;
}

export interface ListSubmissionsParams {
  limit?: number;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string | null;
  status?: StatusFilter;
  sort?: SortDir;
}

/** Snapshot of the document the results screen needs (labels come from here). */
export interface DocumentSummary {
  id: string;
  title: string;
  type: DocumentBody["type"];
  status: "draft" | "published" | "archived";
  /** Workspace-unique slug — used for the public link `/p/:slug`. */
  slug: string;
  updatedAt: string | null;
  body: DocumentBody;
}

// ---------------------------------------------------------------------------
// Summary / aggregates
// ---------------------------------------------------------------------------

export type NpsClass = "promoter" | "passive" | "detractor";

/** One bar in a choice distribution. */
export interface ChoiceBucket {
  optionId: string | null;
  /** Display label; option label, "Other" bucket, or fallback. */
  label: string;
  count: number;
  isOther?: boolean;
}

export interface ChoiceAggregate {
  kind: "choice";
  blockId: string;
  label: string;
  /** Submissions that answered this block. */
  totalResponses: number;
  distribution: ChoiceBucket[];
}

export interface RatingAggregate {
  kind: "rating";
  blockId: string;
  label: string;
  scale: number;
  totalResponses: number;
  average: number;
  distribution: Array<{ value: number; count: number }>;
}

export interface NpsAggregate {
  kind: "nps";
  blockId: string;
  label: string;
  totalResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** %promoters − %detractors, rounded to an integer. */
  score: number;
}

export interface NumberAggregate {
  kind: "number";
  blockId: string;
  label: string;
  totalResponses: number;
  average: number;
  min: number;
  max: number;
}

export interface TextAggregate {
  kind: "text";
  blockId: string;
  label: string;
  totalResponses: number;
  /** Most recent answers, for a quick qualitative read. */
  recent: string[];
}

export interface FileAggregate {
  kind: "file";
  blockId: string;
  label: string;
  totalResponses: number;
  fileCount: number;
}

/** Question kinds we do not chart (defensive fallback for Phase 2 kinds). */
export interface UnsupportedAggregate {
  kind: "unsupported";
  blockId: string;
  label: string;
  totalResponses: number;
}

export type BlockAggregate =
  | ChoiceAggregate
  | RatingAggregate
  | NpsAggregate
  | NumberAggregate
  | TextAggregate
  | FileAggregate
  | UnsupportedAggregate;

export interface SummaryCounts {
  total: number;
  completed: number;
  draft: number;
  spam: number;
  /** completed / total (0 when total is 0), rounded to an integer percent. */
  completionRate: number;
}

export interface SummaryResponse {
  counts: SummaryCounts;
  /** One aggregate per question block, in document order. */
  blocks: BlockAggregate[];
  generatedAt: string;
}

/** Re-exported so T15 modules can share one import surface. */
export type { Block };
