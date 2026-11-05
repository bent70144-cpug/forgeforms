// AI draft: prompt → DocumentBody (spec §15 M8).
// Strict validation against the DocumentBody zod schema with exactly ONE
// repair attempt; a clear AppError otherwise. The provider is injected so
// tests use a FakeProvider with fixture responses.
import {
  AppError,
  BLOCK_KIND_CHEATSHEET,
  DocumentBody as DocumentBodySchema,
  KNOWN_BLOCK_KINDS,
  err,
  ok,
  type Block,
  type DocumentBody,
  type DocumentType,
  type Result,
} from "../bridge";
import { extractJson, zodIssuesToDetails, AI_JSON_CONTRACT, blockKindCheatsheet } from "./prompt";
import type { AiProvider } from "./provider";

export const DRAFT_MAX_TOKENS = 8192;

export type DraftInput = {
  prompt: string;
  documentType: DocumentType;
};

export type DraftSuccess = {
  body: DocumentBody;
  /** 1 = first attempt, 2 = after the single repair attempt. */
  attempts: number;
};

export type DraftDeps = {
  provider: AiProvider;
  /** Total attempts allowed; default 2 = initial + one repair (spec M8). */
  maxAttempts?: number;
};

export function buildDraftSystemPrompt(): string {
  return [
    "You are FormForge's form/landing-page/portfolio drafting assistant.",
    "You produce a single JSON object that validates against the FormForge DocumentBody schema.",
    "",
    blockKindCheatsheet(),
    "",
    "DOCUMENT BODY SHAPE (JSON):",
    `{
  "schemaVersion": 1,
  "type": "form" | "page" | "portfolio",
  "theme": { "tokens": {}, "fontHeading": "Inter", "fontBody": "Inter", "radius": "md" },
  "settings": {
    "seo": {}, "locale": "en", "progressBar": true, "autoAdvance": true,
    "showBranding": true, "captcha": false, "notifyEmails": []
  },
  "blocks": [ { "id": "b1", "kind": "<from cheatsheet>", "props": {} } ],
  "endings": [ { "id": "e1", "title": "Thanks" } ],
  "logic": { "rules": [] }
}`,
    "",
    "RULES:",
    "- Block ids: short, unique across the whole document (use the pattern b1, b2, ...).",
    "- For documents of type \"form\", include question blocks (from the cheatsheet) and finish with endings.",
    "- For pages/portfolios, prefer content blocks (hero, text, image, ...).",
    "- Do not use logic rules unless the user explicitly asks for conditional flow.",
    "",
    AI_JSON_CONTRACT,
  ].join("\n");
}

export function buildDraftUserPrompt(input: DraftInput): string {
  return [
    `Document type: ${input.documentType}`,
    `User request: ${input.prompt}`,
    "Return the complete DocumentBody JSON object now.",
  ].join("\n");
}

export type DraftValidationFailure = { ok: false; issues: string[] };

/**
 * Validates a candidate draft:
 *  1. DocumentBody zod schema (strict — spec M8),
 *  2. every block kind (recursively) must exist in the §7.2 catalog,
 *  3. block ids must be unique across the tree.
 */
export function validateDraftBody(
  value: unknown,
): { ok: true; body: DocumentBody } | DraftValidationFailure {
  const parsed = DocumentBodySchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: zodIssuesToDetails(parsed.error.issues).map(
        (i) => `${i.path}: ${i.message}`,
      ),
    };
  }

  const kindIssues: string[] = [];
  const seenIds = new Set<string>();
  const walk = (block: Block) => {
    if (!KNOWN_BLOCK_KINDS.has(block.kind)) {
      kindIssues.push(`blocks[${block.id}].kind: unknown block kind "${block.kind}"`);
    }
    if (seenIds.has(block.id)) {
      kindIssues.push(`blocks[${block.id}].id: duplicate block id "${block.id}"`);
    }
    seenIds.add(block.id);
    for (const child of block.children ?? []) walk(child);
  };
  for (const block of parsed.data.blocks) walk(block);

  if (kindIssues.length > 0) return { ok: false, issues: kindIssues };
  return { ok: true, body: parsed.data };
}

function repairUserPrompt(issues: string[], input: DraftInput): string {
  return [
    buildDraftUserPrompt(input),
    "",
    "Your previous reply was invalid against the DocumentBody schema:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Return the corrected complete DocumentBody JSON object only.",
  ].join("\n");
}

export async function generateDraftBody(
  deps: DraftDeps,
  input: DraftInput,
): Promise<Result<DraftSuccess>> {
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 2); // spec: initial + ONE repair
  const system = buildDraftSystemPrompt();
  let issues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user =
      attempt === 1 ? buildDraftUserPrompt(input) : repairUserPrompt(issues, input);

    const completion = await deps.provider.complete({
      system,
      user,
      maxTokens: DRAFT_MAX_TOKENS,
      temperature: 0.2,
    });
    if (!completion.ok) return err(completion.error);

    const json = extractJson(completion.value);
    if (!json.ok) {
      issues = ["reply was not parseable as a single JSON object"];
      continue;
    }

    const validated = validateDraftBody(json.value);
    if (validated.ok) return ok({ body: validated.body, attempts: attempt });
    issues = validated.issues;
  }

  return err(
    new AppError(
      "AI_OUTPUT_INVALID",
      "AI draft failed DocumentBody validation after one repair attempt",
      { issues, attempts: maxAttempts },
    ),
  );
}

// Re-exported for the module interface; keeps the §7.2 catalog visible to
// callers building their own prompts or tests.
export { BLOCK_KIND_CHEATSHEET, KNOWN_BLOCK_KINDS };
