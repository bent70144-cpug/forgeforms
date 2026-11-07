// Builder integration glue (wave 3) — the PURE decision logic behind
// BuilderPage's wiring, extracted so the UI stays thin and the decisions are
// unit-testable in plain node (no DOM, no effects).
//
// Contents:
// - planRecovery        §7.2/§7.3 — what to do with a stored offline batch on
//                         load (stale batches with ops route into the §7.3
//                         conflict flow, follow-up #2)
// - staleConflictEvent  §7.3 — the ConflictEvent for a stale offline batch
// - planCopyBlocks      §6.4 — the subtree a Cmd/Ctrl+C copies
// - planPasteOps        §6.4 — where a paste inserts + its re-id'd ops
// - bannerKindFor       §7.4 vs §14 — archived always wins over multitab
// - rejectionNoticeText §14  — copy for the "one change was rejected" notice
// - sharedOfflineQueue  §22.2 — HMR-safe module singleton (globalThis cache)

import type { Block, DocumentEnvelope } from "../bridge";
import type { PendingBatchRecord } from "./offline";
import { createOfflineQueue, type OfflineQueuePort } from "./offline";
import { BODY_LIMIT_NOTICE } from "./limits";
import { pasteBlocksToOps } from "./clipboard";
import { findBlock, type Op } from "./ops";
import type { EditorState } from "./store";
import type { ConflictEvent, OpRejectedEvent } from "./autosave";

// ---------------------------------------------------------------------------
// §7.2 recovery planning (+ §7.3 conflict routing, follow-up #2)
// ---------------------------------------------------------------------------

export type RecoveryPlan = "restore" | "conflict" | "discard";

/**
 * Decide what the load flow does with a stored §22.2 record (§7.2 + §7.3):
 * - `"restore"`  → record.baseRev matches the loaded envelope rev and there
 *                  is at least one op: offer Restore/Discard (RestorePrompt);
 *                  Restore dispatches the ops through the normal apply path.
 * - `"conflict"` → the record was written against an OLDER rev (the document
 *                  moved on — another device saved since) but still holds
 *                  ops: route it into the §7.3 conflict flow (follow-up #2)
 *                  instead of the old Discard-only prompt — the caller
 *                  fetches the current server document and opens the SAME
 *                  ConflictDialog a live 409 raises (local pending ops vs
 *                  server doc; `staleConflictEvent` builds the event). If
 *                  that fetch fails, the caller falls back to the old
 *                  Discard-only prompt (RestorePrompt "discard-stale").
 * - `"discard"`  → a stale record with NO ops: dead weight that can never
 *                  apply again — clear the stored record silently (no
 *                  prompt, nothing to merge or restore).
 * - `null`       → nothing to do (no record, an empty matching-rev record —
 *                  harmless —, or a future rev — nonsense; recoverPending
 *                  drops these).
 */
export function planRecovery(
  record: PendingBatchRecord | null | undefined,
  serverRev: number,
): RecoveryPlan | null {
  if (!record) return null;
  if (!Array.isArray(record.ops) || record.ops.length === 0) {
    // Nothing to restore or merge: an empty matching-rev record is harmless,
    // a stale one can never apply again — drop it quietly.
    return record.baseRev < serverRev ? "discard" : null;
  }
  if (record.baseRev === serverRev) return "restore";
  if (record.baseRev < serverRev) return "conflict";
  return null; // baseRev > serverRev — nonsense; recoverPending drops these
}

/** Human count for the prompt: "Restore unsaved changes (N edits)?" */
export function countRecoveryEdits(ops: readonly Op[]): number {
  return ops.length;
}

/**
 * The §7.3 ConflictEvent for a stale §22.2 record (follow-up #2): the local
 * pending ops vs the freshly fetched server document. BuilderPage feeds it
 * into the same ConflictDialog + resolveConflict flow a live 409 uses.
 */
export function staleConflictEvent(
  record: PendingBatchRecord,
  envelope: DocumentEnvelope,
): ConflictEvent {
  return {
    rev: envelope.rev,
    serverDoc: { meta: { title: envelope.title, slug: envelope.slug }, body: envelope.body },
    serverBody: envelope.body,
    pendingOps: [...record.ops],
  };
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

/**
 * §13/§14 hard-limit notice copy (follow-up #10): the 1 MB flush refusal.
 * Single source of truth so the autosave controller's status message and the
 * shell notice stay in sync.
 */
export function limitExceededNoticeText(): string {
  return BODY_LIMIT_NOTICE;
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


