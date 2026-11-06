// packages/blocks — `section` public renderer (server-safe).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { resolveSectionBackground } from "./background";
import type { SectionProps } from "./schema";

export const SectionRender: FC<RenderProps<SectionProps>> = ({ props, children }) => {
  const background = resolveSectionBackground(props.background);
  return (
    <section
      className={`ff-section ff-section--${props.padding}`}
      data-block-kind="section"
      style={background !== null ? { background } : undefined}
    >
      {children}
    </section>
  );
};
