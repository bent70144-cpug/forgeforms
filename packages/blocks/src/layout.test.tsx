// T21 — `section` + `columns` layout blocks: schemas, background guard,
// children passthrough.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionProps, sectionDefaultProps } from "./section/schema";
import { resolveSectionBackground } from "./section/background";
import { SectionRender } from "./section/render";
import { ColumnsProps, columnsDefaultProps } from "./columns/schema";
import { ColumnsEditor } from "./columns/editor";
import { ColumnsRender } from "./columns/render";

describe("section props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(SectionProps.parse(sectionDefaultProps())).toEqual({ background: "none", padding: "md" });
  });

  it("fills the padding default", () => {
    expect(SectionProps.parse({}).padding).toBe("md");
  });

  it("rejects an unknown padding", () => {
    expect(SectionProps.safeParse({ padding: "huge" }).success).toBe(false);
  });

  it("round-trips an editor edit (padding → lg, background set)", () => {
    const props = SectionProps.parse(sectionDefaultProps());
    const edited: unknown = { ...props, padding: "lg", background: "var(--ff-muted)" };
    expect(SectionProps.parse(edited)).toEqual({ background: "var(--ff-muted)", padding: "lg" });
  });
});

describe("resolveSectionBackground (no untrusted CSS injection)", () => {
  it("maps theme token aliases to CSS variables", () => {
    expect(resolveSectionBackground("bg")).toBe("var(--ff-bg)");
    expect(resolveSectionBackground("primary")).toBe("var(--ff-primary)");
    expect(resolveSectionBackground("color.muted")).toBe("var(--ff-muted)");
  });

  it("passes real CSS colors and var() references", () => {
    expect(resolveSectionBackground("#f5f5f5")).toBe("#f5f5f5");
    expect(resolveSectionBackground("rgb(10 20 30)")).toBe("rgb(10 20 30)");
    expect(resolveSectionBackground("var(--ff-border)")).toBe("var(--ff-border)");
    expect(resolveSectionBackground("transparent")).toBe("transparent");
  });

  it("returns null for none/empty/unknown/dangerous values", () => {
    expect(resolveSectionBackground("none")).toBeNull();
    expect(resolveSectionBackground("")).toBeNull();
    expect(resolveSectionBackground(undefined)).toBeNull();
    expect(resolveSectionBackground("expression(alert(1))")).toBeNull();
    expect(resolveSectionBackground("url(https://example.com/x.png)")).toBeNull();
    expect(resolveSectionBackground("not-a-color")).toBeNull();
  });
});

describe("section render", () => {
  it("renders children with padding class and resolved background", () => {
    const props = SectionProps.parse({ background: "primary", padding: "lg" });
    const html = renderToStaticMarkup(
      <SectionRender props={props}>
        <p>inside</p>
      </SectionRender>,
    );
    expect(html).toContain('data-block-kind="section"');
    expect(html).toContain("ff-section--lg");
    expect(html).toContain('background:var(--ff-primary)');
    expect(html).toContain("inside");
  });

  it("omits the style attribute when the background is unsafe", () => {
    const props = SectionProps.parse({ background: "url(https://example.com/x.png)" });
    const html = renderToStaticMarkup(<SectionRender props={props} />);
    expect(html).not.toContain("background:");
  });
});

describe("columns props schema (spec §7.2: count 2–4; §9.2: ratios, stackOrder)", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(ColumnsProps.parse(columnsDefaultProps())).toEqual({ count: 2 });
  });

  it("rejects counts outside 2–4", () => {
    expect(ColumnsProps.safeParse({ count: 1 }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 5 }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 3.5 }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 4 }).success).toBe(true);
  });

  it("round-trips an editor edit (count → 4)", () => {
    const props = ColumnsProps.parse(columnsDefaultProps());
    expect(ColumnsProps.parse({ ...props, count: 4 })).toEqual({ count: 4 });
    expect(ColumnsProps.safeParse({ ...props, count: 7 }).success).toBe(false);
  });

  it("§9.2 ratios/stackOrder: old docs parse unchanged; new keys accept 1..12 / 1..4 ranks", () => {
    // Old stored documents carry neither key.
    expect(ColumnsProps.parse({ count: 3 })).toEqual({ count: 3 });
    expect(ColumnsProps.safeParse({ count: 2, ratios: [1, 2] }).success).toBe(true);
    expect(ColumnsProps.safeParse({ count: 2, ratios: [1, 12] }).success).toBe(true);
    expect(ColumnsProps.safeParse({ count: 2, ratios: [1, 13] }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 2, ratios: [0, 1] }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 2, ratios: [1, 2, 3, 4, 5] }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 2, stackOrder: [2, 1] }).success).toBe(true);
    expect(ColumnsProps.safeParse({ count: 2, stackOrder: [1, 5] }).success).toBe(false);
    expect(ColumnsProps.safeParse({ count: 2, stackOrder: [1, 0.5] }).success).toBe(false);
  });
});

describe("columns render (§9.2: desktop ratios + mobile stack order)", () => {
  it("renders children into an equal-width CSS grid", () => {
    const html = renderToStaticMarkup(
      <ColumnsRender props={{ count: 3 }}>
        <div>one</div>
        <div>two</div>
      </ColumnsRender>,
    );
    expect(html).toContain('data-block-kind="columns"');
    expect(html).toContain('data-count="3"');
    expect(html).toContain("repeat(3, minmax(0, 1fr))");
    expect(html).toContain("one");
    expect(html).toContain("two");
  });

  it("§9.2 ratios drive the desktop grid template (missing entries fall back to 1fr)", () => {
    const html = renderToStaticMarkup(
      <ColumnsRender props={{ count: 3, ratios: [2, 1] }}>
        <div>one</div>
      </ColumnsRender>,
    );
    expect(html).toContain("minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)");
    expect(html).toContain('data-count="3"');
  });

  it("§9.2 stackOrder wraps children in ordered cells with a mobile-only media query", () => {
    const html = renderToStaticMarkup(
      <ColumnsRender props={{ count: 2, stackOrder: [2, 1] }}>
        <div key="a">one</div>
        <div key="b">two</div>
      </ColumnsRender>,
    );
    expect(html).toContain("ff-columns--stacked");
    expect(html).toContain('data-stack-order="2,1"');
    expect(html).toContain("ff-columns__cell");
    expect(html).toContain("--ff-stack-order:2");
    expect(html).toContain("--ff-stack-order:1");
    expect(html).toContain("@media (max-width: 640px)");
    expect(html).toContain("order:var(--ff-stack-order,0)");
    expect(html).toContain("one");
    expect(html).toContain("two");
  });

  it("without stackOrder the markup stays exactly as before (no wrapper cells)", () => {
    const html = renderToStaticMarkup(
      <ColumnsRender props={{ count: 2, ratios: [1, 3] }}>
        <div>one</div>
      </ColumnsRender>,
    );
    expect(html).not.toContain("ff-columns--stacked");
    expect(html).not.toContain("ff-columns__cell");
    expect(html).not.toContain("@media");
    expect(html).toContain("minmax(0, 1fr) minmax(0, 3fr)");
  });
});

describe("columns editor (§9.2 ratio + stack-order controls)", () => {
  const noop = (): void => {};

  it("exposes a ratio input and a stack-order input per column", () => {
    const props = ColumnsProps.parse({ count: 3, ratios: [2, 1, 1], stackOrder: [2, 1, 3] });
    const html = renderToStaticMarkup(
      <ColumnsEditor blockId="blk_columns1" props={props} onChange={noop} />,
    );
    expect(html).toContain('data-kind="columns"');
    expect(html).toContain("Column ratios (desktop)");
    expect(html).toContain("Mobile stack order");
    expect((html.match(/Column 1 ratio/g) ?? []).length).toBe(1);
    expect((html.match(/Column 3 mobile stack order/g) ?? []).length).toBe(1);
    // Existing values round-trip into the inputs.
    expect(html).toContain('value="2"');
    expect(html).toContain('value="3"');
  });

  it("defaults materialize per-column values when the props omit the arrays", () => {
    const html = renderToStaticMarkup(
      <ColumnsEditor blockId="blk_columns2" props={ColumnsProps.parse({})} onChange={noop} />,
    );
    // count 2 → two ratio inputs at 1 and two stack ranks at 1, 2.
    expect((html.match(/Column \d ratio/g) ?? []).length).toBe(2);
    expect((html.match(/Column \d mobile stack order/g) ?? []).length).toBe(2);
    expect(html).toContain('value="2"');
  });
});
