// packages/blocks — renders a stored block from the registry (spec §7.1).
// OWNED BY T06 (issue #6).
import type { ReactElement } from "react";
import type { Block } from "@formforge/schema";
import { getBlockDef } from "./registry";

export type BlockViewProps = {
  block: Block;
  /** Current answer (question blocks); forwarded to nested children too. */
  answer?: unknown;
  onAnswer?: (value: unknown) => void;
  disabled?: boolean;
};

/**
 * Render a stored block via its registered `Render` component.
 *
 * Registry rules (spec §7.1): an unknown `kind` in a stored document renders as
 * nothing and never crashes; stored props that fail the kind's `propsSchema`
 * also render as nothing (fail soft — SPEC-NOTE: the spec only mandates the
 * unknown-kind case; invalid props are treated the same way so the public
 * renderer can never crash on stored data).
 *
 * A block with `hidden: true` renders as nothing (the logic engine toggles this
 * at runtime; SPEC-NOTE: the conversational/scroll renderers — T10/T12 — may
 * bypass `BlockView` for step-level control).
 */
export function BlockView({ block, answer, onAnswer, disabled }: BlockViewProps): ReactElement | null {
  const def = getBlockDef(block.kind);
  if (!def) return null;
  if (block.hidden) return null;
  const parsed = def.propsSchema.safeParse(block.props);
  if (!parsed.success) return null;
  const Render = def.Render;
  const children = block.children?.map((child) => (
    <BlockView
      key={child.id}
      block={child}
      answer={answer}
      onAnswer={onAnswer}
      disabled={disabled}
    />
  ));
  return (
    <Render props={parsed.data} answer={answer} onAnswer={onAnswer} disabled={disabled}>
      {children}
    </Render>
  );
}
