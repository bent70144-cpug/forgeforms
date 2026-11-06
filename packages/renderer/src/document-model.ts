// packages/renderer/src/document-model.ts — conversational-plane document
// model (spec §7 DocumentBody as rendered). ISSUE #30: moved from the retired
// src/bridge.ts.
//
// SPEC-NOTE (re-ticketed with the issue #30 follow-up): the `welcome` screen
// shape is not pinned in spec §7's DocumentBody — the renderer reads
// `doc.welcome` if present, otherwise it skips the welcome screen. Align with
// T06's @formforge/schema when the schema adds the field (or move it to
// settings.welcome). Until then these structural types stay renderer-local so
// the client bundle never pulls the schema package's runtime in.
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
  /** SPEC-NOTE: see the module header — shape pending alignment with T06. */
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
