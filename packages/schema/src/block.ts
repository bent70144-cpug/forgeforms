// packages/schema — block node (spec §7).
// OWNED BY T06 (issue #6).
import { z } from "zod";

// SPEC-NOTE: the `Block` type is declared explicitly (not via z.infer) because
// Zod cannot infer a recursive schema in strict TS: `z.lazy(() => Block)` inside
// the object's initializer makes `z.infer<typeof BlockBase>` circular
// (TS7022/TS2456). The shape is exactly spec §7's inferred type.
export type Block = {
  id: string; // stable, nanoid(10)
  kind: string;
  props: Record<string, unknown>; // validated by the kind's own schema (packages/blocks)
  children?: Block[];
  hidden?: boolean;
};

// SPEC-NOTE: spec §7 shows `props: z.record(z.unknown())` (Zod 3 style).
// Zod 4 canonical form requires an explicit key schema; semantics are identical.
export const BlockBase: z.ZodType<Block> = z.object({
  id: z.string().min(1),
  kind: z.string(),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.lazy(() => Block)).optional(),
  hidden: z.boolean().optional(),
});

// Same schema value under the spec's `Block` name (spec §7).
export const Block: z.ZodType<Block> = BlockBase;

/** Duplicate a block with a fresh id (deep). Helper for the builder (T08). */
export function cloneBlockWithNewId(block: Block, newId: string): Block {
  return {
    ...block,
    id: newId,
    children: block.children?.map((child, i) =>
      cloneBlockWithNewId(child, `${newId}-${i}`),
    ),
  };
}
