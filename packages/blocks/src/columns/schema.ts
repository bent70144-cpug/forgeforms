// packages/blocks — `columns` props schema (spec §7.2 layout block:
// count(2-4), children). Children live on the block node, not in props.
// §9.2 additions: per-column desktop `ratios` (grid fractions) and mobile
// `stackOrder` ranks. Both are optional arrays so every stored document from
// before they existed parses unchanged (backward-compatible expansion).
// OWNED BY T21 (issue #21).
import { z } from "zod";

export const ColumnsCount = z.number().int().min(2).max(4);

/** Desktop width weight per column (fr units); 1 = equal share. */
export const ColumnRatio = z.number().int().min(1).max(12);

/** Mobile stacking rank per column (1 stacks first). */
export const ColumnStackRank = z.number().int().min(1).max(4);

export const ColumnsProps = z.strictObject({
  count: ColumnsCount.default(2),
  ratios: z.array(ColumnRatio).max(4).optional(),
  stackOrder: z.array(ColumnStackRank).max(4).optional(),
});

export type ColumnsCount = z.infer<typeof ColumnsCount>;
export type ColumnRatio = z.infer<typeof ColumnRatio>;
export type ColumnStackRank = z.infer<typeof ColumnStackRank>;
export type ColumnsProps = z.infer<typeof ColumnsProps>;

export const columnsDefaultProps = (): ColumnsProps => ({ count: 2 });
