// INTEGRATION-DEBT: awaiting T10 (issue #10) — `getPublishedSnapshot` will live in
// @formforge/core (spec §8 "Snapshot shape", §10 "Public plane"). packages/core is
// still an empty stub, so this file defines ONLY the contract the scroll renderer
// codes against, plus a placeholder reader.
//
// When T10 lands, reduce this file to a single re-export:
//   export { getPublishedSnapshot } from "@formforge/core";
//   export type { Snapshot, Result, AppError } from "@formforge/core";
// Nothing outside `src/index.ts` imports the bridge, so the swap stays one line.
//
// Types are intentionally lenient (spec fields optional) so a snapshot built by T10
// remains assignable even if optional fields drift; every consumer handles absence.

/** Block as stored in the published snapshot (spec §7 Block, post-sanitize). */
export type SnapshotBlock = {
  id?: string;
  kind?: string;
  props?: Record<string, unknown>;
  children?: SnapshotBlock[];
  hidden?: boolean;
};

/** Ending as stored in the published snapshot (spec §7 endings). */
export type SnapshotEnding = {
  id?: string;
  title?: string;
  body?: string;
  redirectUrl?: string;
};

/** SEO fields resolved onto the snapshot (spec §7 settings.seo + §8). */
export type SnapshotSeo = {
  title?: string;
  description?: string;
  ogImageAssetId?: string;
  /** INTEGRATION-DEBT: T10 resolves ogImageAssetId → CDN URL; accept either spelling. */
  ogImageUrl?: string;
  ogImage?: string;
};

export type SnapshotSettings = {
  progressBar?: boolean;
  autoAdvance?: boolean;
  showBranding?: boolean;
  captcha?: boolean;
  closeAt?: string;
};

export type SnapshotType = "form" | "page" | "portfolio";

/** Published snapshot (spec §8 `snapshots.rendered`). */
export type Snapshot = {
  documentId?: string;
  versionId?: string;
  type?: SnapshotType;
  title?: string;
  seo?: SnapshotSeo;
  locale?: string;
  /** Theme resolved to CSS variables by the snapshot builder (e.g. "--ff-bg": "#fbf9f4"). */
  cssVars?: Record<string, string>;
  blocks?: SnapshotBlock[];
  endings?: SnapshotEnding[];
  routing?: Record<string, unknown>;
  settings?: SnapshotSettings;
};

/** Minimal AppError shape (spec §3: services return Result<T, AppError>). */
export type AppError = {
  code: string;
  message: string;
  details?: unknown;
};

/** Result type from the shared kernel (spec §3). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type GetPublishedSnapshot = (slug: string) => Promise<Result<Snapshot, AppError>>;

/**
 * Placeholder reader — ALWAYS fails until T10 wires the real implementation.
 * The scroll route maps the failure to a 404 with a server-side console.error,
 * so a missing integration fails visibly but never crashes the public plane.
 */
export const getPublishedSnapshot: GetPublishedSnapshot = async () => ({
  ok: false,
  error: {
    code: "NOT_IMPLEMENTED",
    message:
      "getPublishedSnapshot is a placeholder — INTEGRATION-DEBT awaiting T10 (issue #10). " +
      "Re-export the real reader from @formforge/core in packages/renderer/src/bridge.ts.",
  },
});


// ---- T12 additions (lead merge) ----
export interface Block {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[];
  hidden?: boolean;
}

export interface Theme {
  tokens: Record<string, string>; // e.g. "color.bg": "#fbf9f4"
  fontHeading?: string;
  fontBody?: string;
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export type RuleOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'isEmpty'
  | 'matches';

export interface RuleCondition {
  left: string; // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
  op: RuleOp;
  right?: unknown;
}

export type RuleAction =
  | { type: 'goto'; target: string } // blockId | "end:<endingId>"
  | { type: 'set'; var: string; value: unknown };

export interface Rule {
  id: string;
  scope: string; // blockId this rule runs after, or "start"
  when: RuleCondition[];
  then: RuleAction[];
  isFallback?: boolean;
}

export interface Ending {
  id: string;
  title: string;
  body?: string;
  redirectUrl?: string;
}

export interface DocumentSettings {
  locale?: string;
  progressBar?: boolean;
  autoAdvance?: boolean;
  showBranding?: boolean;
  captcha?: boolean;
  closeAt?: string;
  maxSubmissions?: number;
}

export interface WelcomeConfig {
  enabled?: boolean;
  title?: string;
  body?: string;
  buttonText?: string;
}

export interface DocumentBody {
  schemaVersion: 1;
  type: 'form' | 'page' | 'portfolio';
  /** Document title (snapshot carries it per spec §8). */
  title?: string;
  theme?: Theme;
  settings?: DocumentSettings;
  blocks: Block[];
  endings: Ending[];
  logic?: { rules: Rule[] };
  /**
   * INTEGRATION-DEBT: welcome screen shape is not pinned in spec §7's DocumentBody.
   * The renderer reads `doc.welcome` if present, otherwise it skips the welcome
   * screen. Align with T06 when the schema lands (or move to settings.welcome).
   */
  welcome?: WelcomeConfig;
}

export const QUESTION_KINDS = [
  'short-text',
  'long-text',
  'email',
  'number',
  'single-select',
  'dropdown',
  'rating',
  'nps',
  'file-upload', // T16 (issue #16) — answer { assetIds } (spec §7.2)
] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

export function isQuestionKind(kind: string): kind is QuestionKind {
  return (QUESTION_KINDS as readonly string[]).includes(kind);
}

export const INSTANT_ANSWER_KINDS: readonly QuestionKind[] = [
  'single-select',
  'dropdown',
  'rating',
  'nps',
];

export function isInstantAnswer(kind: string): boolean {
  return (INSTANT_ANSWER_KINDS as readonly string[]).includes(kind);
}
