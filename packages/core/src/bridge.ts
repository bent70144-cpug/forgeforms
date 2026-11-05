// INTEGRATION-DEBT: awaiting T06
// Minimal bridge of the block-document schemas (spec §7) until `@formforge/schema`
// (built in parallel by T06, issue #6) is mergeable on this branch.
//
// Swap plan for the integrator: delete this file and re-point imports from
// `@formforge/core` templates module to `@formforge/schema`. The schemas below are
// copied 1:1 from spec.md §7 so the swap should be mechanical. Only the block
// kinds actually used by the W1-22 seed templates are listed in TEMPLATE_BLOCK_KINDS;
// the zod schema itself stays spec-exact (`kind: z.string()`), which is what the
// stored documents validate against.
import { z } from "zod";

/** Block kinds used by the W1-22 seed templates (spec §7.2 catalog subset). */
export const TEMPLATE_BLOCK_KINDS = [
  // content
  "hero",
  "text",
  "image",
  "gallery",
  "video",
  "testimonials",
  "faq",
  "pricing",
  "projects",
  "contact-links",
  // layout
  "section",
  "columns",
  // action
  "button",
  "form-embed",
  // question
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
] as const;

export type TemplateBlockKind = (typeof TEMPLATE_BLOCK_KINDS)[number];

export type Block = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[] | undefined;
  hidden?: boolean | undefined;
};

export const BlockBase: z.ZodType<Block> = z.object({
  id: z.string().min(1), // stable, nanoid(10)-style
  kind: z.string(),
  props: z.record(z.string(), z.unknown()), // validated by the kind's own schema
  children: z.array(z.lazy(() => BlockBase)).optional(),
  hidden: z.boolean().optional(),
});
export const Block: z.ZodType<Block> = BlockBase;

export type Theme = z.infer<typeof ThemeBase>;
export const ThemeBase = z.object({
  tokens: z.record(z.string(), z.string()), // e.g. "color.bg": "#fbf9f4"
  fontHeading: z.string().default("Inter"),
  fontBody: z.string().default("Inter"),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).default("md"),
});

export type Rule = z.infer<typeof RuleBase>;
export const RuleBase = z.object({
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

export type Ending = z.infer<typeof EndingBase>;
export const EndingBase = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  redirectUrl: z.url().optional(),
});

export type DocumentBody = z.infer<typeof DocumentBodyBase>;
export const DocumentBodyBase = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(["form", "page", "portfolio"]),
  theme: ThemeBase,
  settings: z.object({
    seo: z
      .object({ title: z.string().optional(), description: z.string().optional(), ogImageAssetId: z.string().optional() })
      .default({}),
    locale: z.string().default("en"),
    progressBar: z.boolean().default(true),
    autoAdvance: z.boolean().default(true),
    showBranding: z.boolean().default(true),
    captcha: z.boolean().default(false),
    closeAt: z.iso.datetime().optional(),
    maxSubmissions: z.number().int().positive().optional(),
    notifyEmails: z.array(z.email()).default([]),
  }),
  blocks: z.array(BlockBase),
  endings: z.array(EndingBase).default([]),
  logic: z.object({ rules: z.array(RuleBase) }).default({ rules: [] }),
});
export const DocumentBody: z.ZodType<DocumentBody> = DocumentBodyBase;

// ---------------------------------------------------------------------------
// Authoring-time input types.
// NOTE: hand-written mirrors of the schema's *input* shape (fields with defaults
// optional). Deriving them via `z.input<typeof X>` doesn't work here because
// BlockBase/DocumentBodyBase are annotated as `z.ZodType<Output>`, which erases
// the input side. The CI suite parses every template against the real schema, so
// drift between these mirrors and the zod schema fails loudly.
// ---------------------------------------------------------------------------
export type BlockInput = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: BlockInput[];
  hidden?: boolean;
};

export type ThemeInput = {
  tokens: Record<string, string>;
  fontHeading?: string;
  fontBody?: string;
  radius?: "none" | "sm" | "md" | "lg" | "full";
};

export type EndingInput = {
  id: string;
  title: string;
  body?: string;
  redirectUrl?: string;
};

export type RuleInput = {
  id: string;
  scope: string;
  when: {
    left: string; // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
    op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "isEmpty" | "matches";
    right?: unknown;
  }[];
  then: ({ type: "goto"; target: string } | { type: "set"; var: string; value: unknown })[];
  isFallback?: boolean;
};

export type DocumentBodyInput = {
  schemaVersion: 1;
  type: "form" | "page" | "portfolio";
  theme: ThemeInput;
  settings: {
    seo?: { title?: string; description?: string; ogImageAssetId?: string };
    locale?: string;
    progressBar?: boolean;
    autoAdvance?: boolean;
    showBranding?: boolean;
    captcha?: boolean;
    closeAt?: string;
    maxSubmissions?: number;
    notifyEmails?: string[];
  };
  blocks: BlockInput[];
  endings?: EndingInput[];
  logic?: { rules: RuleInput[] };
};
