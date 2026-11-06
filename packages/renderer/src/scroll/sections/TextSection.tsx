import type { TextViewProps } from "../blocks";

// SPEC-NOTE: the HTML arrives sanitized at publish time (spec §8 snapshot build).
// The scroll renderer deliberately does not re-parse it; Tiptap JSON input is
// degraded to escaped plain paragraphs in blocks.ts/renderRichText instead.

/** Content block: text (spec §7.2). Server component — zero client JS. */
export function TextSection({ props }: { props: TextViewProps }) {
  if (props.html.trim() === "") return null;
  return (
    <section className="ff-section-text px-6 py-10">
      <div
        className="ff-prose mx-auto w-full max-w-3xl text-[var(--ff-fg)]"
        style={{ fontFamily: "var(--ff-font-body, inherit)", lineHeight: 1.7 }}
        dangerouslySetInnerHTML={{ __html: props.html }}
      />
    </section>
  );
}
