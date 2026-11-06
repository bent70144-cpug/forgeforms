import type { ButtonViewProps } from "../blocks";

/** Action block: button (spec §7.2). Server component — zero client JS. */
export function ButtonSection({ props }: { props: ButtonViewProps }) {
  if (props.label === "" || props.href === null) return null;
  const variantStyle: React.CSSProperties =
    props.variant === "primary"
      ? { backgroundColor: "var(--ff-primary)", color: "var(--ff-primary-fg)", border: "1px solid transparent" }
      : props.variant === "outline"
        ? { backgroundColor: "transparent", color: "var(--ff-fg, inherit)", border: "1px solid var(--ff-border)" }
        : { backgroundColor: "transparent", color: "var(--ff-fg, inherit)", border: "1px solid transparent" };
  return (
    <section className="ff-section-button px-6 py-6">
      <div className="mx-auto flex w-full max-w-3xl justify-center">
        <a
          href={props.href}
          className="inline-block rounded-[var(--ff-radius)] px-6 py-3 text-base font-semibold no-underline transition-opacity hover:opacity-90"
          style={variantStyle}
        >
          {props.label}
        </a>
      </div>
    </section>
  );
}
