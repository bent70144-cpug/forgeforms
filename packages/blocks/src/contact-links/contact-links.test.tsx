// T21 — `contact-links` schema + render (spec §7.2: links[{type,url}]).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactLinksProps, contactLinksDefaultProps } from "./schema";
import { ContactLinksRender } from "./render";

describe("contact-links props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = ContactLinksProps.parse(contactLinksDefaultProps());
    expect(props.links).toEqual([{ type: "email", url: "hello@example.com" }]);
  });

  it("fills the type default", () => {
    const props = ContactLinksProps.parse({ links: [{ url: "https://example.com" }] });
    expect(props.links[0]?.type).toBe("other");
  });

  it("rejects an unknown link type", () => {
    expect(ContactLinksProps.safeParse({ links: [{ type: "mastodon", url: "x" }] }).success).toBe(false);
  });

  it("rejects an empty url", () => {
    expect(ContactLinksProps.safeParse({ links: [{ type: "email", url: "" }] }).success).toBe(false);
  });

  it("round-trips an editor edit (email → website)", () => {
    const props = ContactLinksProps.parse(contactLinksDefaultProps());
    const edited: unknown = { links: [{ ...props.links[0]!, type: "website", url: "https://example.com" }] };
    expect(ContactLinksProps.parse(edited).links[0]?.type).toBe("website");
  });
});

describe("contact-links render", () => {
  it("adds mailto:/tel: schemes and keeps https URLs", () => {
    const html = renderToStaticMarkup(
      <ContactLinksRender
        props={{
          links: [
            { type: "email", url: "hello@example.com" },
            { type: "phone", url: "+1 555 0100" },
            { type: "github", url: "https://github.com/example" },
          ],
        }}
      />,
    );
    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).toContain('href="tel:+15550100"');
    expect(html).toContain('href="https://github.com/example"');
    expect(html).toContain('data-block-kind="contact-links"');
  });

  it("collapses javascript: hrefs to # (never emits script URLs)", () => {
    const html = renderToStaticMarkup(
      <ContactLinksRender props={{ links: [{ type: "other", url: "javascript:alert(1)" }] }} />,
    );
    // The href is neutralized; the raw value only appears as escaped link text.
    expect(html).toContain('href="#"');
    expect(html).not.toContain('href="javascript:');
  });

  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<ContactLinksRender props={{ links: [] }} />)).toBe("");
  });
});
