// T21 — `section` + `columns` layout blocks: schemas, background guard,
// children passthrough.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionProps, sectionDefaultProps } from "./section/schema";
import { resolveSectionBackground } from "./section/background";
import { SectionRender } from "./section/render";
import { ColumnsProps, columnsDefaultProps } from "./columns/schema";
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

describe("columns props schema (spec §7.2: count 2–4)", () => {
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
});

describe("columns render", () => {
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
});
