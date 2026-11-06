// packages/blocks — `columns` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { ColumnsEditor } from "./editor";
import { ColumnsRender } from "./render";
import { ColumnsProps, columnsDefaultProps } from "./schema";

export const columnsBlock: BlockDef<ColumnsProps> = {
  kind: "columns",
  family: "layout",
  label: "Columns",
  icon: "columns-3",
  propsSchema: ColumnsProps,
  defaultProps: columnsDefaultProps,
  Editor: ColumnsEditor,
  Render: ColumnsRender,
};

registerBlock(columnsBlock);
