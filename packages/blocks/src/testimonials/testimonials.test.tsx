// T21 — `testimonials` schema + render (spec §7.2: items[{quote,name,role,
// avatarAssetId}]).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TestimonialsProps, testimonialsDefaultProps } from "./schema";
import { TestimonialsRender } from "./render";

const SAMPLE = {
  quote: "Fastest form builder we have used.",
  name: "Ada Lovelace",
  role: "CTO",
};

describe("testimonials props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = TestimonialsProps.parse(testimonialsDefaultProps());
    expect(props.items).toHaveLength(1);
    expect(props.items[0]?.name).toBe("Ada Lovelace");
  });

  it("accepts avatar refs through the T16 adapter seam (string or resolved)", () => {
    expect(TestimonialsProps.safeParse({ items: [{ ...SAMPLE, avatarAssetId: "ast_0001" }] }).success).toBe(true);
    expect(
      TestimonialsProps.safeParse({
        items: [{ ...SAMPLE, avatarAssetId: { src: "https://cdn.example.com/a.jpg", blurDataURL: "data:x" } }],
      }).success,
    ).toBe(true);
    expect(TestimonialsProps.safeParse({ items: [{ ...SAMPLE, avatarAssetId: {} }] }).success).toBe(false);
  });

  it("rejects an empty quote or name", () => {
    expect(TestimonialsProps.safeParse({ items: [{ quote: "", name: "A" }] }).success).toBe(false);
    expect(TestimonialsProps.safeParse({ items: [{ quote: "q", name: "" }] }).success).toBe(false);
  });

  it("fills the role default", () => {
    const props = TestimonialsProps.parse({ items: [{ quote: "q", name: "A" }] });
    expect(props.items[0]?.role).toBe("");
  });

  it("round-trips an editor edit (append + edit item)", () => {
    const props = TestimonialsProps.parse(testimonialsDefaultProps());
    const edited: unknown = {
      ...props,
      items: [...props.items, { ...SAMPLE, quote: "Loved by analysts." }],
    };
    expect(TestimonialsProps.parse(edited).items).toHaveLength(2);
  });
});

describe("testimonials render", () => {
  it("renders quote, name and role", () => {
    const html = renderToStaticMarkup(<TestimonialsRender props={{ items: [SAMPLE] }} />);
    expect(html).toContain('data-block-kind="testimonials"');
    expect(html).toContain("Fastest form builder we have used.");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("CTO");
  });

  it("renders the avatar image when present and nothing when absent", () => {
    const withAvatar = renderToStaticMarkup(
      <TestimonialsRender props={{ items: [{ ...SAMPLE, avatarAssetId: "ast_0001" }] }} />,
    );
    expect(withAvatar).toContain('src="ast_0001"');
    const withoutAvatar = renderToStaticMarkup(<TestimonialsRender props={{ items: [SAMPLE] }} />);
    expect(withoutAvatar).not.toContain("ff-testimonials__avatar");
  });

  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<TestimonialsRender props={{ items: [] }} />)).toBe("");
  });
});
