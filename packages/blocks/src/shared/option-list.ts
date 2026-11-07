// packages/blocks — select-option schema + helpers shared by single-select,
// multi-select and dropdown (spec §7.2: options[{id,label}]).
// OWNED BY T09 (issue #9).
import { z } from "zod";

export const Option = z.strictObject({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(500),
});

export type Option = z.infer<typeof Option>;

/** §9.2/§7.2 hard cap on select options (one shared constant, never drifts). */
export const MAX_OPTIONS = 200;

// A question without options cannot be answered — at least one is required.
export const OptionList = z.array(Option).min(1).max(MAX_OPTIONS);

/** The option ids a select-kind question accepts ("known options"). */
export function knownOptionIds(options: readonly Option[]): string[] {
  return options.map((option) => option.id);
}

/**
 * Match an incoming prefill value against options: exact id first, then exact
 * label (so `?color=Blue` works on author-facing URLs). Case-sensitive exact
 * match keeps the mapping unambiguous.
 */
export function findOption(
  options: readonly Option[],
  idOrLabel: string,
): Option | undefined {
  return options.find((option) => option.id === idOrLabel) ??
    options.find((option) => option.label === idOrLabel);
}

/**
 * Fisher–Yates shuffle for `single-select.randomize` (spec §7.2).
 * The rng is injectable so behavior is deterministic under a seeded test;
 * production callers omit it (Math.random). Never mutates the input.
 */
export function shuffledOptions<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
