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

function unwrapOperand(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('optionId' in obj) return obj['optionId'] ?? undefined;
    if ('other' in obj) return obj['other'] ?? undefined;
    if ('optionIds' in obj) return obj['optionIds'] ?? undefined;
  }
  return value;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('optionId' in obj && isEmptyValue(obj['optionId']) && !('other' in obj)) return true;
    if ('other' in obj && isEmptyValue(obj['other']) && !('optionId' in obj)) return true;
  }
  return false;
}

function conditionPasses(cond: RuleCondition, ctx: LogicContext): boolean {
  let left: unknown;
  if (cond.left.startsWith('@block:')) left = unwrapOperand(ctx.answers[cond.left.slice(7)]);
  else if (cond.left.startsWith('@var:')) left = ctx.variables[cond.left.slice(5)];
  else if (cond.left.startsWith('@hidden:')) left = ctx.hidden[cond.left.slice(8)];
  else left = undefined;

  const right = cond.right;
  switch (cond.op) {
    case 'isEmpty':
      return isEmptyValue(left);
    case 'eq':
      return equalsNormalized(left, right);
    case 'neq':
      return !equalsNormalized(left, right);
    case 'contains': {
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return left.some((item) => equalsNormalized(item, right));
      return false;
    }
    case 'gt':
      return compare(left, right) > 0;
    case 'gte':
      return compare(left, right) >= 0;
    case 'lt':
      return compare(left, right) < 0;
    case 'lte':
      return compare(left, right) <= 0;
    case 'matches': {
      if (typeof left !== 'string' || typeof right !== 'string') return false;
      try {
        return new RegExp(right).test(left);
      } catch {
        return false; // invalid pattern never crashes the flow (spec §9)
      }
    }
    default:
      return false;
  }
}

function equalsNormalized(a: unknown, b: unknown): boolean {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== undefined && nb !== undefined) return na === nb;
  return a === b;
}

function compare(a: unknown, b: unknown): number {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na === undefined || nb === undefined) return Number.NaN;
  return na - nb;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

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

export interface Routing {
  /** Question block ids in document order (default-next traversal path). */
  order: string[];
  endings: string[];
  rulesByScope: Record<string, Rule[]>;
}

export interface LogicContext {
  answers: Record<string, unknown>;
  variables: Record<string, unknown>;
  hidden: Record<string, unknown>;
  currentBlockId: string;
}

export interface LogicResult {
  nextBlockId: string | `end:${string}`;
  variables: Record<string, unknown>;
}

export function compile(rules: Rule[], blocks: Block[]): Routing {
  const order: string[] = [];
  const endings: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!block || typeof block.id !== 'string' || block.hidden === true) continue;
    if (isQuestionKind(block.kind) && !seen.has(block.id)) {
      seen.add(block.id);
      order.push(block.id);
    }
  }
  const rulesByScope: Record<string, Rule[]> = {};
  for (const rule of rules ?? []) {
    if (!rule || typeof rule.scope !== 'string') continue;
    (rulesByScope[rule.scope] ??= []).push(rule);
  }
  // Fallback rules ("in all other cases") must be considered last.
  for (const list of Object.values(rulesByScope)) {
    list.sort((a, b) => Number(a.isFallback === true) - Number(b.isFallback === true));
  }
  return { order, endings, rulesByScope };
}

export function evaluate(routing: Routing, ctx: LogicContext): LogicResult {
  const variables = { ...ctx.variables };
  const currentIndex = routing.order.indexOf(ctx.currentBlockId);

  const defaultNext = (): string => {
    if (currentIndex >= 0 && currentIndex + 1 < routing.order.length) {
      return routing.order[currentIndex + 1] as string;
    }
    return `end:${routing.endings[0] ?? 'default'}`;
  };

  const rules = routing.rulesByScope[ctx.currentBlockId] ?? [];
  let gotoTarget: string | null = null;

  for (const rule of rules) {
    if (rule.isFallback && gotoTarget !== null) break;
    const when = rule.when ?? [];
    const passes = when.every((cond) => conditionPasses(cond, ctx));
    if (!passes) continue;
    for (const action of rule.then ?? []) {
      if (action.type === 'set') variables[action['var']] = action.value;
      else if (action.type === 'goto') gotoTarget = action.target;
    }
    break; // first match wins
  }

  if (gotoTarget !== null) {
    if (gotoTarget.startsWith('end:')) return { nextBlockId: gotoTarget, variables };
    if (routing.order.includes(gotoTarget)) return { nextBlockId: gotoTarget, variables };
    // Unknown target → default next, never crash (spec §9).
  }

  return { nextBlockId: defaultNext(), variables };
}
