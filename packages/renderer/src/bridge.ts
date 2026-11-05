// INTEGRATION-DEBT: awaiting T06 (packages/schema) and T13 (packages/core logic).
// This bridge file provides the MINIMAL types the conversational renderer needs,
// mirroring spec §7 (DocumentBody/Block/Rule/Ending) and spec §9 (compile/evaluate)
// so that T12 can build and test in parallel. When T06/T13 land:
//   1. delete every type below and re-export from '@formforge/schema';
//   2. delete compile()/evaluate() and import from '@formforge/core' (logic module);
//   3. accept the snapshot's pre-compiled `routing` (spec §8) instead of compiling locally.
// NOTHING here may be edited in packages/schema/** or packages/core/** — this file
// lives entirely inside packages/renderer and is safe to remove at integration time.

// ---------------------------------------------------------------------------
// Document types (mirror of spec §7)
// ---------------------------------------------------------------------------

/** Block props are untyped here on purpose: T06 owns the per-kind Zod schemas. */
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

// ---------------------------------------------------------------------------
// Question kinds the conversational renderer supports in W1 (spec §7.2).
// multi-select / file-upload are MVP catalog but land with later tickets.
// ---------------------------------------------------------------------------

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

/** Blocks that trigger auto-advance right after an answer (spec §10.2). */
export const INSTANT_ANSWER_KINDS: readonly QuestionKind[] = [
  'single-select',
  'dropdown',
  'rating',
  'nps',
];

export function isInstantAnswer(kind: string): boolean {
  return (INSTANT_ANSWER_KINDS as readonly string[]).includes(kind);
}

// ---------------------------------------------------------------------------
// Logic engine (mirror of spec §9 interface). Tiny local stub — T13 owns the
// real engine (golden tests, lint, cycles). The stub keeps the exact signature
// `compile(rules, blocks)` / `evaluate(routing, ctx)` so the renderer swap is
// a one-line import change.
// ---------------------------------------------------------------------------

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

/**
 * Stub semantics (spec §9): rules scoped to the current block run in array
 * order, first rule whose `when` all pass wins; fallback rules run only if
 * nothing matched. Unknown goto targets fall back to the default next.
 */
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
