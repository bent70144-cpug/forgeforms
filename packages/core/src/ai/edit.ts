// Edit-with-AI: instruction + current document → proposed DocumentOp list
// (spec §8 vocabulary, §15 M8). The AI NEVER applies anything: this module
// only ever returns a reviewable proposal, and the future server-side apply
// path is guarded by assertEditConfirmed() so confirmation cannot be skipped.
import { z } from "zod";
import { AppError, err, ok, type Result } from "../bridge";
import { DocumentBody as DocumentBodySchema } from "./types";
import { type DocumentBody } from "./types";
import { AI_JSON_CONTRACT, blockKindCheatsheet, extractJson, zodIssuesToDetails } from "./prompt";
import type { AiProvider } from "./provider";
import {
  DocumentOp as DocumentOpSchema,
  describeOps,
  validateOpsAgainstDocument,
  type DocumentOp,
} from "./ops";

export const EDIT_MAX_TOKENS = 4096;

export type AiEditInput = {
  instruction: string;
  document: DocumentBody;
};

export type EditProposal = {
  ops: DocumentOp[];
  /** Model-provided one-line intent, shown above the diff. */
  summary: string;
  /** Human-readable per-op diff lines rendered in the review UI. */
  diff: string[];
  /** 1 = first attempt, 2 = after the single repair attempt. */
  attempts: number;
};

export type EditDeps = {
  provider: AiProvider;
  /** Total attempts allowed; default 2 = initial + one repair. */
  maxAttempts?: number;
};

export function buildEditSystemPrompt(): string {
  return [
    "You are FormForge's document editing assistant.",
    "You receive a user instruction and the current DocumentBody JSON, and you propose",
    "a list of operations (ops) that an editor would apply. You never apply them yourself.",
    "",
    blockKindCheatsheet(),
    "",
    "OP VOCABULARY (only these op types):",
    `{ "type": "block.insert", "parentId"?: string, "index": number, "block": { "id", "kind", "props" } }`,
    `{ "type": "block.update", "id": string, "props": object }`,
    `{ "type": "block.move", "id": string, "parentId"?: string, "index": number }`,
    `{ "type": "block.remove", "id": string }`,
    `{ "type": "settings.update", "settings": partial settings object }`,
    `{ "type": "theme.update", "theme": partial theme object }`,
    `{ "type": "ending.upsert", "ending": { "id", "title", "body"?, "redirectUrl"? } }`,
    `{ "type": "ending.remove", "id": string }`,
    `{ "type": "rule.upsert", "rule": { "id", "scope", "when", "then", "isFallback" } }`,
    `{ "type": "rule.remove", "id": string }`,
    `{ "type": "meta.update", "meta": { "title"?, "slug"? } }`,
    "",
    "RULES:",
    "- block.update / block.move / block.remove / ending.remove / rule.remove must reference ids that exist in the document.",
    "- block.insert must use a fresh block id that does not exist yet.",
    "- Prefer minimal diffs: change only what the instruction requires.",
    "- Do not touch answers/submissions; you only see the document structure.",
    "",
    "Reply with exactly this JSON shape:",
    '{ "summary": "<one sentence>", "ops": [ ... ] }',
    "",
    AI_JSON_CONTRACT,
  ].join("\n");
}

export function buildEditUserPrompt(input: AiEditInput): string {
  return [
    "Current document (DocumentBody JSON):",
    JSON.stringify(input.document),
    "",
    `User instruction: ${input.instruction}`,
    'Return the JSON object { "summary", "ops" } now.',
  ].join("\n");
}

export type EditReplyValidation =
  | { ok: true; ops: DocumentOp[]; summary: string }
  | { ok: false; issues: string[] };

const EditReply = z.object({
  summary: z.string().min(1),
  ops: z.array(DocumentOpSchema),
});

export function validateEditReply(
  value: unknown,
  document: DocumentBody,
): EditReplyValidation {
  const parsed = EditReply.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: zodIssuesToDetails(parsed.error.issues).map((i) => `${i.path}: ${i.message}`),
    };
  }
  const docParsed = DocumentBodySchema.safeParse(document);
  if (!docParsed.success) {
    return { ok: false, issues: ["the current document itself failed DocumentBody validation"] };
  }
  const opCheck = validateOpsAgainstDocument(parsed.data.ops, docParsed.data);
  if (!opCheck.ok) return { ok: false, issues: opCheck.issues };
  return { ok: true, ops: parsed.data.ops, summary: parsed.data.summary };
}

function repairUserPrompt(issues: string[], input: AiEditInput): string {
  return [
    buildEditUserPrompt(input),
    "",
    "Your previous reply was invalid:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Return the corrected { summary, ops } JSON object only.",
  ].join("\n");
}

/**
 * Proposes ops for an instruction. Returns a proposal only — applying it is
 * the user's explicit decision, made in the review UI after seeing `diff`.
 */
export async function proposeEditOps(
  deps: EditDeps,
  input: AiEditInput,
): Promise<Result<EditProposal>> {
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 2); // initial + ONE repair
  const system = buildEditSystemPrompt();
  let issues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user =
      attempt === 1 ? buildEditUserPrompt(input) : repairUserPrompt(issues, input);

    const completion = await deps.provider.complete({
      system,
      user,
      maxTokens: EDIT_MAX_TOKENS,
      temperature: 0.2,
    });
    if (!completion.ok) return err(completion.error);

    const json = extractJson(completion.value);
    if (!json.ok) {
      issues = ["reply was not parseable as a single JSON object"];
      continue;
    }

    const validated = validateEditReply(json.value, input.document);
    if (validated.ok) {
      return ok({
        ops: validated.ops,
        summary: validated.summary,
        diff: describeOps(validated.ops, input.document),
        attempts: attempt,
      });
    }
    issues = validated.issues;
  }

  return err(
    new AppError(
      "AI_OUTPUT_INVALID",
      "AI edit failed op validation after one repair attempt",
      [
        ...issues.map((message) => ({ path: "ops", message })),
        { path: "attempts", message: String(maxAttempts) },
      ],
    ),
  );
}

// ---------------------------------------------------------------------------
// Confirmation guard (issue #27: "AI ops never applied without explicit user
// confirmation — UI + service-level guard").
// ---------------------------------------------------------------------------

export const EDIT_CONFIRMATION_TOKEN = "user-confirmed" as const;

/**
 * Service-level guard for any code path that would apply AI-proposed ops to
 * a document. The UI must pass the token only from the "Apply" action shown
 * next to the reviewable diff. Without the token this returns
 * CONFIRMATION_REQUIRED and the ops MUST NOT be applied.
 */
export function assertEditConfirmed(confirmation: string | undefined): Result<true> {
  if (confirmation !== EDIT_CONFIRMATION_TOKEN) {
    return err(
      new AppError(
        "CONFIRMATION_REQUIRED",
        "AI-proposed ops may only be applied after the user confirms the reviewable diff",
      ),
    );
  }
  return ok(true);
}
