// @formforge — builder bridge types.
//
// INTEGRATION-DEBT: awaiting T06/T07
// Structural, dependency-free copies of the wire types the builder needs
// (spec §7 DocumentBody / Block / Theme / Rule; §11 document envelope).
// When packages/schema (T06) and the documents CRUD (T07) land, replace the
// definitions below with re-exports of the real Zod-inferred types, e.g.
//   export type { Block, DocumentBody, Theme } from "@formforge/schema";
// Nothing else in apps/web should change — everything imports from here.
//
// Owner: T08 (issue #8).

export type DocumentType = "form" | "page" | "portfolio";

/** spec §7 — stable nanoid(10) ids, props validated by the kind's own schema. */
export type Block = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[];
  hidden?: boolean;
};

export type ThemeRadius = "none" | "sm" | "md" | "lg" | "full";

/** spec §7 — tokens are CSS-variable-ish strings, e.g. "color.bg": "#fbf9f4". */
export type Theme = {
  tokens: Record<string, string>;
  fontHeading: string;
  fontBody: string;
  radius: ThemeRadius;
};

export type DocumentSettings = {
  seo: {
    title?: string;
    description?: string;
    ogImageAssetId?: string;
  };
  locale: string;
  progressBar: boolean;
  autoAdvance: boolean;
  showBranding: boolean;
  captcha: boolean;
  closeAt?: string;
  maxSubmissions?: number;
  notifyEmails: string[];
  /**
   * T20 (spec §14.1.4): optional hidden-field extras beyond the standard UTM
   * set (standard set is always captured client-side). INTEGRATION-DEBT /
   * TODO(merge): align with T07's DocumentSettings schema — if T07 strips
   * unknown settings keys, this rides client-side only until the schema lands.
   */
  hiddenFields?: Array<{ name: string; label?: string }>;
};

export type Ending = {
  id: string;
  title: string;
  body?: string;
  redirectUrl?: string;
};

export type RuleCondition = {
  left: string; // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "isEmpty" | "matches";
  right?: unknown;
};

export type RuleAction =
  | { type: "goto"; target: string } // blockId | "end:<endingId>"
  | { type: "set"; var: string; value: unknown };

export type Rule = {
  id: string;
  scope: string; // blockId this rule runs after, or "start"
  when: RuleCondition[];
  then: RuleAction[];
  isFallback: boolean;
};

/** spec §7 — the heart of the product: one block-document model. */
export type DocumentBody = {
  schemaVersion: 1;
  type: DocumentType;
  theme: Theme;
  settings: DocumentSettings;
  blocks: Block[];
  endings: Ending[];
  logic: { rules: Rule[] };
};

export type DocumentStatus = "draft" | "published";

// SPEC-NOTE: envelope shape is the client contract for GET /api/v1/documents/:id
// (spec §11 "Get draft + metadata"). T07 maps its rows to this shape; the exact
// server field names may differ slightly (e.g. `{ document: … }` wrapper) and
// ApiTransport tolerates both.
export type DocumentEnvelope = {
  id: string;
  /** Authoritative server revision; PATCH conflicts (409) carry the current one. */
  rev: number;
  title: string;
  slug?: string;
  status: DocumentStatus;
  type: DocumentType;
  body: DocumentBody;
  updatedAt?: string;
};

/** Canonical theme token keys ↔ CSS variables (spec §14.3). */
export const THEME_TOKEN_VARS = {
  "color.bg": "--ff-bg",
  "color.fg": "--ff-fg",
  "color.primary": "--ff-primary",
  "color.primaryFg": "--ff-primary-fg",
  "color.muted": "--ff-muted",
  "color.border": "--ff-border",
} as const;

export type ThemeTokenKey = keyof typeof THEME_TOKEN_VARS;

export const DEFAULT_THEME_TOKENS: Record<ThemeTokenKey, string> = {
  "color.bg": "#ffffff",
  "color.fg": "#0f172a",
  "color.primary": "#4f46e5",
  "color.primaryFg": "#ffffff",
  "color.muted": "#64748b",
  "color.border": "#e2e8f0",
};
