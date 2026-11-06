// T21 — `pricing` schema + render (spec §7.2: tiers[{name,price,features[],cta}]).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PricingProps, pricingDefaultProps } from "./schema";
import { PricingRender } from "./render";

describe("pricing props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = PricingProps.parse(pricingDefaultProps());
    expect(props.tiers).toHaveLength(2);
    expect(props.tiers[1]?.cta).toEqual({ label: "Start free trial", href: "/signup" });
  });

  it("fills the price and features defaults", () => {
    const props = PricingProps.parse({ tiers: [{ name: "Solo" }] });
    expect(props.tiers[0]?.price).toBe("");
    expect(props.tiers[0]?.features).toEqual([]);
  });

  it("rejects a cta without href", () => {
    expect(PricingProps.safeParse({ tiers: [{ name: "Solo", cta: { label: "Go" } }] }).success).toBe(false);
  });

  it("rejects more than 10 tiers", () => {
    const tiers = Array.from({ length: 11 }, () => ({ name: "T" }));
    expect(PricingProps.safeParse({ tiers }).success).toBe(false);
  });

  it("round-trips an editor edit (rename + add feature)", () => {
    const props = PricingProps.parse(pricingDefaultProps());
    const edited: unknown = {
      tiers: [{ ...props.tiers[0]!, name: "Starter", features: [...props.tiers[0]!.features, "Community support"] }],
    };
    const parsed = PricingProps.parse(edited);
    expect(parsed.tiers[0]?.name).toBe("Starter");
    expect(parsed.tiers[0]?.features).toEqual(["Up to 3 forms", "100 submissions/mo", "Community support"]);
  });
});

describe("pricing render", () => {
  it("renders tiers with name, price, features and a safe cta link", () => {
    const html = renderToStaticMarkup(
      <PricingRender
        props={{
          tiers: [
            { name: "Free", price: "$0", features: ["3 forms"] },
            { name: "Pro", price: "$19", features: ["Unlimited"], cta: { label: "Buy", href: "/buy" } },
          ],
        }}
      />,
    );
    expect(html).toContain('data-block-kind="pricing"');
    expect(html).toContain("Free");
    expect(html).toContain("$19");
    expect(html).toContain("Unlimited");
    expect(html).toContain('href="/buy"');
  });

  it("collapses javascript: cta hrefs to #", () => {
    const html = renderToStaticMarkup(
      <PricingRender
        props={{ tiers: [{ name: "Evil", price: "", features: [], cta: { label: "X", href: "javascript:alert(1)" } }] }}
      />,
    );
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:");
  });
});
