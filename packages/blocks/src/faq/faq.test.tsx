// T21 — `faq` schema + render (spec §7.2: items[{q,a}]).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FaqProps, faqDefaultProps } from "./schema";
import { FaqRender } from "./render";

describe("faq props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = FaqProps.parse(faqDefaultProps());
    expect(props.items[0]).toEqual({
      q: "What is FormForge?",
      a: "A form, page and portfolio builder with logic, analytics and embeds.",
    });
  });

  it("rejects an empty question or answer", () => {
    expect(FaqProps.safeParse({ items: [{ q: "", a: "a" }] }).success).toBe(false);
    expect(FaqProps.safeParse({ items: [{ q: "q", a: "" }] }).success).toBe(false);
  });

  it("rejects unknown prop keys (strict)", () => {
    expect(FaqProps.safeParse({ items: [], bogus: 1 }).success).toBe(false);
  });

  it("round-trips an editor edit (replace answer)", () => {
    const props = FaqProps.parse(faqDefaultProps());
    const edited: unknown = { items: [{ q: props.items[0]?.q ?? "", a: "It is a builder." }] };
    expect(FaqProps.parse(edited).items[0]?.a).toBe("It is a builder.");
  });
});

describe("faq render", () => {
  it("renders native details/summary pairs (interactive without client JS)", () => {
    const html = renderToStaticMarkup(
      <FaqRender props={{ items: [{ q: "Is it free?", a: "Yes, for small teams." }] }} />,
    );
    expect(html).toContain('data-block-kind="faq"');
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Is it free?");
    expect(html).toContain("Yes, for small teams.");
  });

  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<FaqRender props={{ items: [] }} />)).toBe("");
  });
});
