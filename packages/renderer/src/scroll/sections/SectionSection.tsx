import type { ReactNode } from "react";
import type { SectionPadding, SectionViewProps } from "../blocks";

const PADDING_Y: Record<SectionPadding, string> = {
  none: "py-0",
  sm: "py-6",
  md: "py-12",
  lg: "py-20",
  xl: "py-28",
};

/**
 * Layout block: section (spec §7.2). Wraps arbitrary child blocks with
 * background + vertical padding; children render recursively via BlockSection.
 */
export function SectionSection({
  props,
  children,
}: {
  props: SectionViewProps;
  children: ReactNode;
}) {
  const style: React.CSSProperties =
    props.background !== null ? { backgroundColor: props.background } : {};
  return (
    <section className={`ff-section ${PADDING_Y[props.padding]}`} style={style}>
      {children}
    </section>
  );
}
