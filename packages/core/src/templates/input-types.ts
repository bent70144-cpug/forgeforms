// packages/core/src/templates/input-types.ts
// Authoring-time input mirrors for template bodies (fields with defaults made
// optional). ISSUE #30: the zod schemas themselves moved to @formforge/schema;
// these hand-written INPUT mirrors stay because @formforge/schema annotates
// `Block` as `z.ZodType<Output>` (input side erased). The CI suite parses
// every template against the real @formforge/schema, so drift fails loudly.

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
