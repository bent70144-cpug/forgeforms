// packages/mcp/src/bridge.ts
// INTEGRATION-DEBT: awaiting T02/T25 (and T06 for the document schema).
// T02 (kernel) has not landed `Ctx`/`Result`/`AppError` in @formforge/core yet and
// T06 has not landed `DocumentBody`/`Op` in @formforge/schema yet, so this package
// carries minimal, spec-faithful stand-ins (spec.md §3, §4, §7, §8) in this ONE file.
//
// When the real packages land, DELETE this file and replace its importers:
//   Ctx, Result, AppError (+codes), Scope  ->  from "@formforge/core"
//   DocumentBody, Block, Theme, Rule, Op   ->  from "@formforge/schema"
// Everything in here mirrors the spec text so the swap is mechanical.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Spec §4 — errors
// ---------------------------------------------------------------------------

export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "INTERNAL";

export type AppErrorDetail = { path: string; message: string };

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: AppErrorDetail[];

  constructor(code: AppErrorCode, message: string, details?: AppErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Spec §3 — Result + Ctx
// ---------------------------------------------------------------------------

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type ActorType = "user" | "token" | "mcp" | "system";

export type Ctx = {
  workspaceId: string;
  actor: { type: ActorType; id: string };
  requestId: string;
  now: () => Date;
};

// ---------------------------------------------------------------------------
// Spec §6 (api_tokens) — token scopes (T25 contract)
// ---------------------------------------------------------------------------

export type Scope = "docs:read" | "docs:write" | "docs:publish" | "submissions:read";

export const TOKEN_SCOPES: readonly Scope[] = [
  "docs:read",
  "docs:write",
  "docs:publish",
  "submissions:read",
];

// ---------------------------------------------------------------------------
// Spec §7 — block document schema (Zod), adapted to Zod 4 syntax
// (z.record requires a key schema; z.email()/z.iso.datetime() replace the
// deprecated string method forms — semantics identical to the spec snippet)
// ---------------------------------------------------------------------------

export interface Block {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[];
  hidden?: boolean;
}

export const Block: z.ZodType<Block> = z.lazy(() =>
  z.object({
    id: z.string().min(1), // stable, nanoid(10)
    kind: z.string(),
    props: z.record(z.string(), z.unknown()), // validated by the kind's own schema
    children: z.array(Block).optional(),
    hidden: z.boolean().optional(),
  }),
);

export const Theme = z.object({
  tokens: z.record(z.string(), z.string()), // e.g. "color.bg": "#fbf9f4"
  fontHeading: z.string().default("Inter"),
  fontBody: z.string().default("Inter"),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).default("md"),
});
export type Theme = z.infer<typeof Theme>;

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
export type Rule = z.infer<typeof Rule>;

export const Ending = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  redirectUrl: z.url().optional(),
});
export type Ending = z.infer<typeof Ending>;

export const Settings = z.object({
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
  closeAt: z.iso.datetime().optional(),
  maxSubmissions: z.number().int().positive().optional(),
  notifyEmails: z.array(z.email()).default([]),
});
export type Settings = z.infer<typeof Settings>;

export const DocumentBody = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(["form", "page", "portfolio"]),
  theme: Theme,
  settings: Settings,
  blocks: z.array(Block),
  endings: z.array(Ending).default([]),
  logic: z.object({ rules: z.array(Rule) }).default({ rules: [] }),
});
export type DocumentBody = z.infer<typeof DocumentBody>;

// ---------------------------------------------------------------------------
// Spec §8 — authoring ops (PATCH /documents/:id applies `{ baseRev, ops }`)
// SPEC-NOTE: the spec lists op names (`block.insert`, `settings.update`, …)
// without exact payload keys; we use `settings` / `theme` / `ending` / `rule`
// as the payload key per op. If T06's schema package differs, adjust here only.
// ---------------------------------------------------------------------------

export const Op = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("block.insert"),
    parentId: z.string().optional(),
    index: z.number().int().min(0),
    block: Block,
  }),
  z.object({ type: z.literal("block.update"), id: z.string().min(1), props: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal("block.move"),
    id: z.string().min(1),
    parentId: z.string().optional(),
    index: z.number().int().min(0),
  }),
  z.object({ type: z.literal("block.remove"), id: z.string().min(1) }),
  z.object({ type: z.literal("settings.update"), settings: Settings.partial() }),
  z.object({ type: z.literal("theme.update"), theme: Theme.partial() }),
  z.object({ type: z.literal("ending.upsert"), ending: Ending }),
  z.object({ type: z.literal("ending.remove"), id: z.string().min(1) }),
  z.object({ type: z.literal("rule.upsert"), rule: Rule }),
  z.object({ type: z.literal("rule.remove"), id: z.string().min(1) }),
  z.object({
    type: z.literal("meta.update"),
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
  }),
]);
export type Op = z.infer<typeof Op>;

// ---------------------------------------------------------------------------
// Validation helpers (error shape per spec §4)
// ---------------------------------------------------------------------------

export function zodIssuesToDetails(error: z.ZodError): AppErrorDetail[] {
  return error.issues.map((issue) => ({ path: formatZodPath(issue.path), message: issue.message }));
}

function formatZodPath(path: PropertyKey[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

export function validateDocumentBody(input: unknown): Result<DocumentBody, AppError> {
  const parsed = DocumentBody.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return err(new AppError("VALIDATION", "Invalid DocumentBody", zodIssuesToDetails(parsed.error)));
}
