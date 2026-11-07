// Builder integration glue (wave 3) — the PURE decision logic behind
// BuilderPage's wiring, extracted so the UI stays thin and the decisions are
// unit-testable in plain node (no DOM, no effects).
//
// Contents:
// - planRecovery        §7.2 — what to do with a stored offline batch on load
// - planCopyBlocks      §6.4 — the subtree a Cmd/Ctrl+C copies
// - planPasteOps        §6.4 — where a paste inserts + its re-id'd ops
// - bannerKindFor       §7.4 vs §14 — archived always wins over multitab
// - rejectionNoticeText §14  — copy for the "one change was rejected" notice
// - sharedOfflineQueue  §22.2 — HMR-safe module singleton (globalThis cache)

import type { Block } from "../bridge";
import type { PendingBatchRecord } from "./offline";
import { createOfflineQueue, type OfflineQueuePort } from "./offline";
import { pasteBlocksToOps } from "./clipboard";
import { findBlock, type Op } from "./ops";
import type { EditorState } from "./store";
import type { OpRejectedEvent } from "./autosave";

// ---------------------------------------------------------------------------
// §7.2 recovery planning
// ---------------------------------------------------------------------------

export type RecoveryPlan = "restore" | "discard-stale";

/**
 * Decide what the RestorePrompt offers for a stored §22.2 record:
 * - `"restore"`       → record.baseRev matches the loaded envelope rev and
 *                       there is at least one op: offer Restore/Discard.
 * - `"discard-stale"` → the record was written against an OLDER rev (the
 *                       document moved on — another device saved since).
 *                       Per §7.2 we do not attempt a merge: Discard-only
 *                       prompt (the load path logs a console warning).
 * - `null`            → nothing worth prompting for (no record, a future rev
 *                       — nonsense state recoverPending already filters — or
 *                       an empty op list).
 */
export function planRecovery(
  record: PendingBatchRecord | null | undefined,
  serverRev: number,
): RecoveryPlan | null {
  if (!record) return null;
  if (!Array.isArray(record.ops) || record.ops.length === 0) return null;
  if (record.baseRev === serverRev) return "restore";
  if (record.baseRev < serverRev) return "discard-stale";
  return null; // baseRev > serverRev — nonsense; recoverPending drops these
}

/** Human count for the prompt: "Restore unsaved changes (N edits)?" */
export function countRecoveryEdits(ops: readonly Op[]): number {
  return ops.length;
}

// ---------------------------------------------------------------------------
// §6.4 clipboard planning (consumed by useClipboardShortcuts)
// ---------------------------------------------------------------------------

/**
 * The blocks Cmd/Ctrl+C copies: the selected block's whole subtree (§6.4
 * "the block and its children"). Null when there is no live selection.
 */
export function planCopyBlocks(state: EditorState): Block[] | null {
  if (!state.selection) return null;
  const found = findBlock(state.body.blocks, state.selection);
  if (!found) return null;
  return [found.block];
}

/**
 * Build the ops for pasting `blocks` relative to the current selection:
 * - selection  → insert after it, in its list (parent's children or root);
 * - no/unknown selection → append at the end of the root list.
 * The last pasted ROOT block id is returned for the post-paste selection.
 * Pure — ids come from the injected `makeId` (tests pin them).
 */
export function planPasteOps(
  state: EditorState,
  blocks: readonly Block[],
  makeId: () => string = defaultPasteId,
): { index: number; parentId: string | null; ops: Op[]; lastInsertedId: string } | null {
  if (blocks.length === 0) return null;

  let index = state.body.blocks.length;
  let parentId: string | null = null;
  const found = state.selection ? findBlock(state.body.blocks, state.selection) : null;
  if (found) {
    const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
    index = found.index + 1;
    parentId = parent?.id ?? null;
  }

  const ops = pasteBlocksToOps(blocks, index, parentId, makeId);
  const last = ops[ops.length - 1];
  if (!last) return null; // unreachable (blocks.length > 0) — narrows for TS
  return { index, parentId, ops, lastInsertedId: last.block.id };
}

/** Deterministic id factory for tests (production uses lib/builder/id.newId). */
const defaultPasteId = (): string => `paste_${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// §7.4 vs §14 banner precedence
// ---------------------------------------------------------------------------

/**
 * Archived always wins (§14 disables editing entirely — multitab advice is
 * moot); otherwise a detected second tab shows the §7.4 banner.
 */
export function bannerKindFor(archived: boolean, multitabSeen: boolean): "archived" | "multitab" | "none" {
  if (archived) return "archived";
  if (multitabSeen) return "multitab";
  return "none";
}

// ---------------------------------------------------------------------------
// §14 op-rejection notice copy
// ---------------------------------------------------------------------------

/** Copy for the dismissable shell-top notice; falls back to a generic line. */
export function rejectionNoticeText(event: Pick<OpRejectedEvent, "code" | "message">): string {
  const detail = typeof event.message === "string" && event.message.trim().length > 0 ? event.message : event.code;
  return `One change was rejected: ${detail}`;
}

// ---------------------------------------------------------------------------
// §14 plan-limit notice copy (402/403 — never a dead-end error, follow-up #8)
// ---------------------------------------------------------------------------

/** Input: the autosave/publish plan-limit event (402 PLAN_LIMIT / 403 FORBIDDEN). */
export type PlanLimitNoticeInput = {
  status: number;
  message?: string;
  /** §13 capability from the 402 body (e.g. notifyEmailsLimit), when present. */
  capability?: string | null;
};

/** §24 client entitlements the copy may cite for a concrete number. */
export type PlanLimitLimits = {
  notifyEmailsLimit?: number | null;
  fileUploadMaxMb?: number | null;
};

/** Friendly subject per §13 capability (fallback line only). */
const PLAN_CAPABILITY_SUBJECTS: Readonly<Record<string, string>> = {
  documents: "documents",
  submissionsPerMonth: "monthly submissions",
  fileUploadMaxMb: "file uploads",
  removeBranding: "branding removal",
  customRedirect: "redirect endings",
  notifyEmailsLimit: "notifications",
  customDomains: "custom domains",
  seats: "team seats",
  analytics: "advanced analytics",
  partialSubmissions: "partial submissions",
  webhooks: "webhooks",
  apiAccess: "API access",
  aiDrafts: "AI drafts",
};

/**
 * Copy for the §14 shell-top plan-limit notice. 402 → "Plan limit reached:
 * …" (concrete limit cited when the client entitlements carry the number);
 * 403 → "Not allowed on this plan". Pure — injectable limits keep it
 * unit-testable without a store.
 */
export function planLimitNoticeText(
  event: PlanLimitNoticeInput,
  limits?: PlanLimitLimits | null,
): string {
  if (event.status === 403) return "Not allowed on this plan";
  if (event.capability === "notifyEmailsLimit" && typeof limits?.notifyEmailsLimit === "number") {
    return `Plan limit reached: notifications are limited to ${limits.notifyEmailsLimit} on your plan`;
  }
  if (event.capability === "fileUploadMaxMb" && typeof limits?.fileUploadMaxMb === "number") {
    return `Plan limit reached: file uploads are capped at ${limits.fileUploadMaxMb} MB on your plan`;
  }
  const subject = event.capability != null ? PLAN_CAPABILITY_SUBJECTS[event.capability] : null;
  if (subject) return `Plan limit reached: ${subject} are limited on your plan`;
  const detail =
    typeof event.message === "string" && event.message.trim().length > 0
      ? event.message
      : "this action is not available on your plan";
  return `Plan limit reached: ${detail}`;
}

// ---------------------------------------------------------------------------
// §22.2 offline queue singleton (survives HMR double-mounts)
// ---------------------------------------------------------------------------

type GlobalQueueCache = typeof globalThis & { __ffBuilderOfflineQueue?: OfflineQueuePort };

/**
 * The AutosaveController's §22.2 mirror. One instance per browser session —
 * cached on globalThis so Next dev's HMR (which re-evaluates modules) never
 * creates a second queue and "forgets" pending records mid-session.
 */
export function sharedOfflineQueue(): OfflineQueuePort {
  const g = globalThis as GlobalQueueCache;
  g.__ffBuilderOfflineQueue ??= createOfflineQueue();
  return g.__ffBuilderOfflineQueue as OfflineQueuePort;
}


