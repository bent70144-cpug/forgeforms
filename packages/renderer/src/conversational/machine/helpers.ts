// Helpers shared by the machine and the React layer.
import { compile, evaluate } from '@formforge/core/logic';
import type { Routing } from '@formforge/core/logic';
import {
  isInstantAnswer,
  isQuestionKind,
  type Block,
  type DocumentBody,
  type Ending,
} from '../../bridge';
import type { MachineDoc, NormalizedSettings, ResolvedEnding } from './types';

export { isInstantAnswer, isQuestionKind };

// T20 (issue #20, spec §15 M5): the machine's logic runs on the SAME engine
// package the server (ingest + publish lint) uses — `@formforge/core/logic`,
// imported through its subpath so the renderer bundle pulls in only the pure
// logic module. `engineEvaluate` is re-exported for the single-engine-package
// integration test (src/__tests__/engine.test.ts).
export { evaluate as engineEvaluate };

/** Top-level question blocks in document order; hidden blocks are skipped. */
export function questionBlocks(document: DocumentBody): Block[] {
  return (document.blocks ?? []).filter(
    (block) => isQuestionKind(block.kind) && block.hidden !== true,
  );
}

/**
 * Compiles the document's logic with the T13 engine. The question-only block
 * list keeps document order identical to the machine's `questions` (the
 * conversational flow never stops on content blocks — engine SPEC-NOTE 2);
 * ending ids resolve `end:<first>` defaults and rule `goto` targets.
 */
export function buildRouting(document: DocumentBody): Routing {
  return compile(
    document.logic?.rules ?? [],
    questionBlocks(document),
    (document.endings ?? []).map((e) => e.id),
  );
}

/**
 * Per-question prefill (spec §7.2: every question block supports the generic
 * `prefillParam` prop): maps URL params → draft answers, keyed by blockId.
 * Only questions with a configured `prefillParam` and a matching non-empty
 * param are prefilled.
 */
export function prefillAnswers(
  document: DocumentBody,
  urlParams: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!urlParams) return {};
  const out: Record<string, unknown> = {};
  for (const block of questionBlocks(document)) {
    const param = block.props['prefillParam'];
    if (typeof param !== 'string' || param === '') continue;
    const value = urlParams[param];
    if (value !== undefined && value !== '') out[block.id] = value;
  }
  return out;
}

export function normalizeSettings(document: DocumentBody): NormalizedSettings {
  const s = document.settings ?? {};
  return {
    progressBar: s.progressBar !== false, // spec §7 default(true)
    autoAdvance: s.autoAdvance !== false,
    showBranding: s.showBranding !== false,
    captcha: s.captcha === true,
  };
}

export function resolveEnding(endings: Ending[], endingId: string | null): ResolvedEnding {
  const first = endings[0];
  const match = endingId ? endings.find((e) => e.id === endingId) : undefined;
  const chosen = match ?? first;
  if (!chosen) {
    // No endings configured — built-in thank-you screen (never a dead end).
    return { id: 'default', title: 'Thanks for your response!', body: null, redirectUrl: null };
  }
  return {
    id: chosen.id,
    title: chosen.title,
    body: chosen.body ?? null,
    redirectUrl: chosen.redirectUrl ?? null,
  };
}

// --- prop readers (props are Record<string, unknown> until T06 schemas land) ---

export function propStr(props: Record<string, unknown>, key: string, fallback = ''): string {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
}

export function propNum(props: Record<string, unknown>, key: string): number | undefined {
  const value = props[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

export function propBool(props: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = props[key];
  return typeof value === 'boolean' ? value : fallback;
}

export interface SelectOption {
  id: string;
  label: string;
}

export function propOptions(props: Record<string, unknown>): SelectOption[] {
  const raw = props['options'];
  if (!Array.isArray(raw)) return [];
  const options: SelectOption[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const id = typeof obj['id'] === 'string' ? obj['id'] : null;
      const label = typeof obj['label'] === 'string' ? obj['label'] : null;
      if (id && label) options.push({ id, label });
    }
  }
  return options;
}

/** Fisher–Yates shuffle used when single-select.randomize is on. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export interface SingleSelectValue {
  optionId?: string;
  other?: string;
}

export function asSelectValue(value: unknown): SingleSelectValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return {
      optionId: typeof obj['optionId'] === 'string' ? obj['optionId'] : undefined,
      other: typeof obj['other'] === 'string' ? obj['other'] : undefined,
    };
  }
  return {};
}

export function buildMachineDoc(document: DocumentBody, documentId = ''): MachineDoc {
  const endings = document.endings ?? [];
  return {
    documentId,
    document,
    questions: questionBlocks(document),
    routing: buildRouting(document),
    settings: normalizeSettings(document),
    hasWelcome: document.welcome?.enabled === true,
    endings,
  };
}
