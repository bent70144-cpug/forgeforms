// @formforge — builder bridge types.
//
// INTEGRATION (T06/T07/T20 merge): the structural copies below are REPLACED by
// re-exports of the canonical Zod-inferred wire types from @formforge/schema
// (packages/schema is the single source of truth for spec §7 shapes, including
// T20's `settings.hiddenFields` extension). Only web-local contracts that the
// schema does not own stay here: the GET-draft DocumentEnvelope (§11 client
// contract), DocumentStatus (2-state client view) and the theme token runtime
// constants.
//
// Owner: T08 (issue #8).

export type {
  Block,
  DocumentBody,
  DocumentSettings,
  DocumentType,
  Ending,
  Rule,
  RuleAction,
  RuleCondition,
  Theme,
} from "@formforge/schema";

// Local aliases for the re-exported names this module itself references.
import type { DocumentBody, DocumentType, Theme } from "@formforge/schema";

/** spec §7 theme radius union (derived — schema owns the canonical Theme). */
export type ThemeRadius = Theme["radius"];

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
