// packages/blocks — `columns` props schema (spec §7.2 layout block:
// count(2-4), children). Children live on the block node, not in props.
// OWNED BY T21 (issue #21).
import { z } from "zod";

export const ColumnsCount = z.number().int().min(2).max(4);

export const ColumnsProps = z.strictObject({
  count: ColumnsCount.default(2),
});

export type ColumnsCount = z.infer<typeof ColumnsCount>;
export type ColumnsProps = z.infer<typeof ColumnsProps>;

export const columnsDefaultProps = (): ColumnsProps => ({ count: 2 });
