// packages/blocks — `columns` public renderer (server-safe).
// Children flow into a CSS grid with `count` equal columns.
import type { FC } from "react";
import type { RenderProps } from "../registry";
import type { ColumnsProps } from "./schema";

export const ColumnsRender: FC<RenderProps<ColumnsProps>> = ({ props, children }) => (
  <div
    className="ff-columns"
    data-block-kind="columns"
    data-count={props.count}
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${props.count}, minmax(0, 1fr))`,
      gap: "1.5rem",
    }}
  >
    {children}
  </div>
);
