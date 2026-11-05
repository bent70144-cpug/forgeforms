// INTEGRATION-DEBT: awaiting T02/T06/T23 — delete this file when the real
// modules land and repoint imports (one-line swaps in src/ai/*):
//   - Ctx / Result / ok / err / AppError / appErrorStatus → T02 kernel
//     (`@formforge/core` src/shared/), spec §3/§4.
//   - DocumentBody / Block / Theme / Rule / DocumentType     → T06
//     (`@formforge/schema` src/document.ts), spec §7.
//   - CanFn (`can(workspaceId, capability)`)              → T23 billing
//     (`@formforge/core` src/billing/), spec §13.
// Everything here is a faithful replica of the spec so that swapping the
// imports is mechanical. Do not add logic to this file.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Kernel primitives (spec §3/§4) — owned by T02
// ---------------------------------------------------------------------------

export type ActorType = "user" | "token" | "mcp" | "system";

export type Ctx = {
  workspaceId: string;
  actor: { type: ActorType; id: string };
  requestId: string;
  now: () => Date;
};

export type ErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "UNAUTHENTICATED"
  | "UNPROCESSABLE"
  | "INTERNAL"
  | "AI_OUTPUT_INVALID"
  | "AI_PROVIDER_ERROR"
  | "AI_NOT_CONFIGURED"
  | "CONFIRMATION_REQUIRED";

// spec §4: API maps codes to HTTP status (404, 403, 422, 409, 429, 402, 500).
const CODE_TO_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  UNAUTHENTICATED: 401,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
  AI_OUTPUT_INVALID: 502,
  AI_PROVIDER_ERROR: 502,
  AI_NOT_CONFIGURED: 503,
  CONFIRMATION_REQUIRED: 422,
};

export function appErrorStatus(code: ErrorCode): number {
  return CODE_TO_STATUS[code] ?? 500;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? appErrorStatus(code);
    this.details = details;
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: AppError): Result<T> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Billing gate (spec §13) — owned by T23. One function only, no inline plan
// checks anywhere else.
// ---------------------------------------------------------------------------

// T23 will narrow this to the real capability union; the AI module only ever
// passes "ai".
export type Capability = string;
export type CanFn = (workspaceId: string, capability: Capability) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Document schema (spec §7) — owned by T06 in packages/schema/src/document.ts.
// ---------------------------------------------------------------------------

export type DocumentType = "form" | "page" | "portfolio";

export type Block = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[] | undefined;
  hidden?: boolean | undefined;
};

const BlockBase = z.object({
  id: z.string().min(1), // stable, nanoid(10)
  kind: z.string(),
  props: z.record(z.string(), z.unknown()), // validated by the kind's own schema
  children: z.array(z.lazy(() => Block)).optional(),
  hidden: z.boolean().optional(),
});

export const Block: z.ZodType<Block> = BlockBase;

export const Theme = z.object({
  tokens: z.record(z.string(), z.string()), // e.g. "color.bg": "#fbf9f4"
  fontHeading: z.string().default("Inter"),
  fontBody: z.string().default("Inter"),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).default("md"),
});

export const Rule = z.object({
  id: z.string(),
  scope: z.string(), // blockId this rule runs after, or "start"
  when: z.array(
    z.object({
      left: z.string(), // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "isEmpty", "matches"]),
      right: z.unknown().optional(),
    }),
  ),
  then: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("goto"), target: z.string() }), // blockId | "end:<endingId>"
      z.object({ type: z.literal("set"), var: z.string(), value: z.unknown() }),
    ]),
  ),
  isFallback: z.boolean().default(false), // "in all other cases"
});

export const DocumentBody = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(["form", "page", "portfolio"]),
  theme: Theme,
  settings: z.object({
    seo: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        ogImageAssetId: z.string().optional(),
      })
      .default({}),
    locale: z.string().default("en"),
    progressBar: z.boolean().default(true),
    autoAdvance: z.boolean().default(true),
    showBranding: z.boolean().default(true),
    captcha: z.boolean().default(false),
    closeAt: z.string().datetime().optional(),
    maxSubmissions: z.number().int().positive().optional(),
    notifyEmails: z.array(z.string().email()).default([]),
  }),
  blocks: z.array(Block),
  endings: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        body: z.string().optional(),
        redirectUrl: z.string().url().optional(),
      }),
    )
    .default([]),
  logic: z.object({ rules: z.array(Rule) }).default({ rules: [] }),
});

export type Theme = z.infer<typeof Theme>;
export type Rule = z.infer<typeof Rule>;
export type DocumentBody = z.infer<typeof DocumentBody>;

// ---------------------------------------------------------------------------
// MVP block catalog (spec §7.2) — the cheatsheet the AI prompt is built from.
// The same set is used to reject drafts that invent unknown block kinds.
// ---------------------------------------------------------------------------

export const BLOCK_KIND_CHEATSHEET: ReadonlyArray<{
  family: "content" | "layout" | "action" | "question";
  kind: string;
  props: string;
}> = [
  { family: "content", kind: "hero", props: "title, subtitle, imageAssetId?, cta?{label,href}" },
  { family: "content", kind: "text", props: "richText (HTML string)" },
  { family: "content", kind: "image", props: "assetId, alt?, caption?" },
  { family: "content", kind: "gallery", props: "assetIds[], layout(grid|masonry), columns" },
  { family: "content", kind: "video", props: "url (YouTube/Vimeo)" },
  { family: "content", kind: "testimonials", props: "items[{quote,name,role,avatarAssetId?}]" },
  { family: "content", kind: "faq", props: "items[{q,a}]" },
  { family: "content", kind: "pricing", props: "tiers[{name,price,features[],cta}]" },
  { family: "content", kind: "projects", props: "items[{title,description,coverAssetId?,link?,tags[]}]" },
  { family: "content", kind: "contact-links", props: "links[{type,url}]" },
  { family: "layout", kind: "section", props: "background?, padding?, children[]" },
  { family: "layout", kind: "columns", props: "count(2-4), children[]" },
  { family: "layout", kind: "multi-question-page", props: "children[] (question blocks)" },
  { family: "action", kind: "button", props: "label, href, style" },
  { family: "action", kind: "form-embed", props: "documentId (type=form)" },
  { family: "question", kind: "short-text", props: "label, placeholder?, required?, maxLength?" },
  { family: "question", kind: "long-text", props: "label, placeholder?, required?, maxLength?" },
  { family: "question", kind: "email", props: "label, required?" },
  { family: "question", kind: "number", props: "label, required?, min?, max?" },
  { family: "question", kind: "single-select", props: "label, options[{id,label}], allowOther?, randomize?" },
  { family: "question", kind: "multi-select", props: "label, options[{id,label}], min?, max?" },
  { family: "question", kind: "dropdown", props: "label, options[{id,label}], searchable?" },
  { family: "question", kind: "rating", props: "label, scale(3-10), icon?" },
  { family: "question", kind: "nps", props: "label, leftLabel?, rightLabel?" },
  { family: "question", kind: "file-upload", props: "label, accept[], maxSizeMb(≤10), maxFiles?" },
];

export const KNOWN_BLOCK_KINDS: ReadonlySet<string> = new Set(
  BLOCK_KIND_CHEATSHEET.map((b) => b.kind),
);
