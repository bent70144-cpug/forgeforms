// @formforge/core — ai module public interface (spec §3).
// AI draft + edit-with-AI + monthly quota (spec §15 M8, issue #27).
// Service functions take Ctx first; results are Result<T, AppError>.
import { type Ctx } from "../shared/ctx.ts";
import { type Result } from "../shared/result.ts";
import { generateDraftBody, type DraftInput, type DraftSuccess } from "./draft";
import { proposeEditOps, type AiEditInput, type EditProposal } from "./edit";
import {
  AI_DRAFT_METRIC,
  AI_EDIT_METRIC,
  checkAiQuota,
  recordAiUsage,
  type QuotaDeps,
  type QuotaState,
} from "./quota";
import type { AiProvider } from "./provider";

export type AiModuleDeps = QuotaDeps & {
  provider: AiProvider;
};

export type AiDraftSuccess = DraftSuccess & { quota: QuotaState };
export type AiEditSuccess = EditProposal & { quota: QuotaState };

/**
 * Prompt → DocumentBody. Order is fixed: entitlement + monthly quota gate
 * BEFORE any provider call, usage persisted only after a valid draft.
 */
export async function runAiDraft(
  ctx: Ctx,
  deps: AiModuleDeps,
  input: DraftInput,
): Promise<Result<AiDraftSuccess>> {
  const quota = await checkAiQuota(ctx, deps, AI_DRAFT_METRIC);
  if (!quota.ok) return quota;

  const draft = await generateDraftBody({ provider: deps.provider }, input);
  if (!draft.ok) return draft;

  const used = await recordAiUsage(ctx, deps, AI_DRAFT_METRIC);
  return { ok: true, value: { ...draft.value, quota: { ...quota.value, used } } };
}

/**
 * Instruction + current document → proposed ops (never applied here). Same
 * gate order as runAiDraft; the proposal must be confirmed by the user in
 * the review UI before anything is applied (assertEditConfirmed).
 */
export async function runAiEdit(
  ctx: Ctx,
  deps: AiModuleDeps,
  input: AiEditInput,
): Promise<Result<AiEditSuccess>> {
  const quota = await checkAiQuota(ctx, deps, AI_EDIT_METRIC);
  if (!quota.ok) return quota;

  const proposal = await proposeEditOps({ provider: deps.provider }, input);
  if (!proposal.ok) return proposal;

  const used = await recordAiUsage(ctx, deps, AI_EDIT_METRIC);
  return { ok: true, value: { ...proposal.value, quota: { ...quota.value, used } } };
}

/** Convenience Ctx factory for HTTP layers (request-scoped clock + actor). */
export function createRequestCtx(input: {
  workspaceId: string;
  actor?: Ctx["actor"];
  requestId?: string;
  now?: () => Date;
}): Ctx {
  return {
    workspaceId: input.workspaceId,
    actor: input.actor ?? { type: "user", id: "unknown" },
    requestId: input.requestId ?? crypto.randomUUID(),
    now: input.now ?? (() => new Date()),
  };
}

// --- module surface ---------------------------------------------------------
export {
  // provider seam
  AnthropicMessagesProvider,
  ANTHROPIC_DEFAULT_MODEL,
  type AiProvider,
  type AiCompletionRequest,
  type AnthropicProviderOptions,
} from "./provider";
export {
  // draft
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  generateDraftBody,
  validateDraftBody,
  DRAFT_MAX_TOKENS,
  type DraftDeps,
  type DraftInput,
  type DraftSuccess,
} from "./draft";
export {
  // edit
  buildEditSystemPrompt,
  buildEditUserPrompt,
  proposeEditOps,
  validateEditReply,
  assertEditConfirmed,
  EDIT_CONFIRMATION_TOKEN,
  EDIT_MAX_TOKENS,
  type AiEditInput,
  type EditDeps,
  type EditProposal,
} from "./edit";
export {
  // ops vocabulary (spec §8) + reviewable diff
  DocumentOp,
  BlockInsertOp,
  BlockUpdateOp,
  BlockMoveOp,
  BlockRemoveOp,
  SettingsUpdateOp,
  ThemeUpdateOp,
  EndingUpsertOp,
  EndingRemoveOp,
  RuleUpsertOp,
  RuleRemoveOp,
  MetaUpdateOp,
  collectBlockIds,
  validateOpsAgainstDocument,
  describeOps,
  type DocumentOp as DocumentOpType,
} from "./ops";
export {
  // quota
  AI_CAPABILITY,
  AI_DRAFT_METRIC,
  AI_EDIT_METRIC,
  AI_MONTHLY_LIMITS,
  checkAiQuota,
  recordAiUsage,
  planLimitFor,
  usagePeriod,
  type AiMetric,
  type AiUsageRepo,
  type Plan,
  type QuotaDeps,
  type QuotaState,
} from "./quota";
export {
  // prompt helpers (golden tests assert the cheatsheet is present)
  AI_JSON_CONTRACT,
  blockKindCheatsheet,
  extractJson,
  zodIssuesToDetails,
} from "./prompt";
export { AppError, toHttpStatus as appErrorStatus } from "../shared/errors.ts";
export { ok, err, type Result } from "../shared/result.ts";
export { type ActorType, type Ctx } from "../shared/ctx.ts";
export type { AppErrorCode as ErrorCode } from "../shared/errors.ts";

// §7 document shape consumed by route tests and the AI workbench.
export { DocumentBody } from "./types";
export type { DocumentBody as DocumentBodyType } from "./types";
export type { DocumentType, CanFn, Capability } from "./types";
