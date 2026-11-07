// packages/blocks — `columns` public renderer (server-safe).
// Children flow into a CSS grid: `count` equal columns by default, or per-
// column `ratios` weights on desktop. When `stackOrder` is set the block also
// stacks to a single column on mobile with the authored per-column ranks
// (§9.2); without it the layout is byte-for-byte what it always was.
import { Children, isValidElement, type CSSProperties, type FC, type ReactNode } from "react";
import type { RenderProps } from "../registry";
import type { ColumnsProps } from "./schema";

/**
 * Desktop grid template. Equal columns (`repeat(n, minmax(0, 1fr))`) unless
 * per-column ratios are given; missing ratio entries fall back to 1fr so a
 * partial array can never produce an invalid template.
 */
export function columnGridTemplate(count: number, ratios?: readonly number[]): string {
  if (!ratios || ratios.length === 0) return `repeat(${count}, minmax(0, 1fr))`;
  return Array.from({ length: count }, (_, i) => `minmax(0, ${ratios[i] ?? 1}fr)`).join(" ");
}

/** Stable key for wrapping a child in a stack-order cell. */
function cellKey(child: ReactNode, index: number): string {
  if (isValidElement(child) && typeof child.key === "string" && child.key !== "") {
    return child.key;
  }
  return `ff-columns-cell-${index}`;
}

// Scoped mobile stacking: the inline `--ff-stack-order` custom properties on
// the cells are inert until this media query applies `order`, so desktop keeps
// the authored column order exactly (§9.2 mobile stack order).
const STACKED_CSS =
  "@media (max-width: 640px){.ff-columns--stacked{grid-template-columns:minmax(0,1fr);}" +
  ".ff-columns--stacked>.ff-columns__cell{order:var(--ff-stack-order,0);}}";

export const ColumnsRender: FC<RenderProps<ColumnsProps>> = ({ props, children }) => {
  const stackOrder = props.stackOrder;
  const stacked = Array.isArray(stackOrder) && stackOrder.length > 0;
  return (
    <div
      className={stacked ? "ff-columns ff-columns--stacked" : "ff-columns"}
      data-block-kind="columns"
      data-count={props.count}
      data-stack-order={stacked ? stackOrder.join(",") : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: columnGridTemplate(props.count, props.ratios),
        gap: "1.5rem",
      }}
    >
      {stacked ? (
        <>
          <style>{STACKED_CSS}</style>
          {Children.toArray(children).map((child, index) => (
            <div
              key={cellKey(child, index)}
              className="ff-columns__cell"
              data-cell-index={index}
              style={{ "--ff-stack-order": String(stackOrder[index] ?? index + 1) } as CSSProperties}
            >
              {child}
            </div>
          ))}
        </>
      ) : (
        children
      )}
    </div>
  );
};
