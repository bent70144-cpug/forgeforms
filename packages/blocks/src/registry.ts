// packages/blocks — block registry (spec §7.1).
// OWNED BY T06 (issue #6).
import type { FC, ReactNode } from "react";
import type { z } from "zod";

export type BlockFamily = "content" | "question" | "action" | "layout";

/** Props handed to a block's builder editor (canvas preview + settings panel). */
export type EditorProps<P> = {
  blockId: string;
  /** Parsed props (defaults applied via `propsSchema`). */
  props: P;
  onChange: (next: P) => void;
  disabled?: boolean;
};

/** Props handed to a block's public renderer (server-safe by default). */
export type RenderProps<P, A = never> = {
  props: P;
  /** Current answer value (question blocks only). */
  answer?: A;
  /** Report an answer change (question blocks only). */
  onAnswer?: (value: A) => void;
  /** Rendered child blocks (layout blocks). */
  children?: ReactNode;
  disabled?: boolean;
  /**
   * T09 (spec §7.2 generic `prefillParam`): URL params the renderer was
   * invoked with, so a question block can show its prefilled value. Optional
   * and additive — content/action blocks ignore it; when absent no prefill
   * applies (public snapshot rendering seeds answers via the logic engine).
   */
  urlParams?: Readonly<Record<string, string>>;
};

// SPEC-NOTE: §7.1 shows `BlockDef<P, A = never>`; kept exactly. Content/action
// blocks therefore have `A = never` and never define answerSchema.
// `validate` uses method syntax (bivariant params) instead of the spec's arrow
// property: with `A = never` an arrow `(answer: never, ...) => ...` is not
// assignable to the registry's erased `BlockDef<any, any>` (any ↛ never), so
// heterogeneous registration would not typecheck. Call-site syntax is identical.
export interface BlockDef<P = unknown, A = never> {
  kind: string;
  family: BlockFamily;
  label: string;
  icon: string;
  propsSchema: z.ZodType<P>;
  defaultProps: () => P;
  /** Question blocks only — ingest validates every answer against it. */
  answerSchema?: z.ZodType<A>;
  /** Server-side + client-side answer check; returns an error message or null. */
  validate?(answer: A, props: P): string | null;
  Editor: FC<EditorProps<P>>;
  Render: FC<RenderProps<P, A>>;
}

// SPEC-NOTE: Editor/Render are erased to `FC<any>` (whole-parameter `any`, not
// per-property) because spec §7.1's `A = never` default puts `never` inside
// `RenderProps.answer` for content blocks; a per-property erased signature like
// `(props: RenderProps<any, any>) => ...` would require `any ↛ never` under
// strictFunctionTypes. `FC<any>` keeps registration assignability exact.
/* eslint-disable @typescript-eslint/no-explicit-any -- erased registry view */
export type AnyBlockDef = {
  kind: string;
  family: BlockFamily;
  label: string;
  icon: string;
  propsSchema: z.ZodType<any>;
  defaultProps: () => any;
  answerSchema?: z.ZodType<any>;
  validate?(answer: any, props: any): string | null;
  Editor: FC<any>;
  Render: FC<any>;
};
/* eslint-enable @typescript-eslint/no-explicit-any -- erased registry view */

export class BlockRegistrationError extends Error {
  readonly kind?: string;

  constructor(message: string, options?: { kind?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BlockRegistrationError";
    this.kind = options?.kind;
  }
}

const FAMILIES: readonly BlockFamily[] = ["content", "question", "action", "layout"];

const registry = new Map<string, AnyBlockDef>();

/**
 * Register a block definition. Runs at import time (spec §7.1) and throws a
 * `BlockRegistrationError` on any invariant violation so a broken block fails
 * loudly at boot instead of silently corrupting documents:
 * - duplicate kind
 * - unknown family
 * - question block without `answerSchema` (ingest must validate answers)
 * - non-question block with `answerSchema` (content blocks never store answers)
 * - `defaultProps()` not satisfying `propsSchema` (blocks are "proven")
 */
export function registerBlock(d: AnyBlockDef): void {
  if (typeof d.kind !== "string" || d.kind === "") {
    throw new BlockRegistrationError("Block definition requires a non-empty `kind` string.");
  }
  if (registry.has(d.kind)) {
    throw new BlockRegistrationError(`Block kind "${d.kind}" is already registered.`, { kind: d.kind });
  }
  if (!FAMILIES.includes(d.family)) {
    throw new BlockRegistrationError(
      `Block "${d.kind}" has unknown family ${JSON.stringify(d.family)}.`,
      { kind: d.kind },
    );
  }
  if (typeof d.Editor !== "function" || typeof d.Render !== "function") {
    throw new BlockRegistrationError(`Block "${d.kind}" requires Editor and Render components.`, {
      kind: d.kind,
    });
  }
  if (d.family === "question" && d.answerSchema === undefined) {
    throw new BlockRegistrationError(`Question block "${d.kind}" must define answerSchema.`, {
      kind: d.kind,
    });
  }
  if (d.family !== "question" && d.answerSchema !== undefined) {
    // SPEC-NOTE: derived from §7.1 "Content blocks never store anything in answers."
    throw new BlockRegistrationError(
      `Only question blocks may define answerSchema (block "${d.kind}" is ${d.family}).`,
      { kind: d.kind },
    );
  }
  if (typeof d.defaultProps !== "function") {
    throw new BlockRegistrationError(`Block "${d.kind}" requires defaultProps().`, { kind: d.kind });
  }
  try {
    d.propsSchema.parse(d.defaultProps());
  } catch (cause) {
    throw new BlockRegistrationError(
      `defaultProps() for block "${d.kind}" do not satisfy propsSchema.`,
      { kind: d.kind, cause },
    );
  }
  registry.set(d.kind, d);
}

/** Look up a block definition; returns `undefined` for unknown kinds (never throws). */
export function getBlockDef(kind: string): AnyBlockDef | undefined {
  return registry.get(kind);
}

export function hasBlockDef(kind: string): boolean {
  return registry.has(kind);
}

/** All registered definitions, in registration order. */
export function listBlockDefs(): AnyBlockDef[] {
  return [...registry.values()];
}

export function blockKinds(): string[] {
  return [...registry.keys()];
}

/** Kind → propsSchema map, for `validateDocumentBody` in @formforge/schema. */
export function registeredKindSchemas(): Record<string, z.ZodType<unknown>> {
  const map: Record<string, z.ZodType<unknown>> = {};
  for (const [kind, def] of registry) {
    map[kind] = def.propsSchema;
  }
  return map;
}
