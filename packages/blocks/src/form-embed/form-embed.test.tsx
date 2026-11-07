// T21 — `form-embed` schema + render: documentId of a published form; renders
// the /embed/:documentId iframe (spec §10.2) with ff:height / ff:complete
// postMessage forwarding upward. Protocol guard tests live in
// ../shared/embed-protocol.test.ts; the live parent listens on the harness page
// (apps/web/app/dev/form-embed-harness).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCUMENT_ID_PATTERN, FormEmbedProps, embedFrameSrc, formEmbedDefaultProps } from "./schema";
import { FormEmbedEditor } from "./editor";
import { FormEmbedRender } from "./render";

const VALID_ID = "doc_2rFdqyaVmzwXDtpdLHVvqb";

describe("form-embed props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = FormEmbedProps.parse(formEmbedDefaultProps());
    expect(DOCUMENT_ID_PATTERN.test(props.documentId)).toBe(true);
  });

  it("accepts a public document id (doc_ + 22 base58 chars)", () => {
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID }).success).toBe(true);
    // base58 excludes 0, O, I, l
    expect(FormEmbedProps.safeParse({ documentId: "doc_0OIl" + "1".repeat(18) }).success).toBe(false);
  });

  it("rejects malformed document ids", () => {
    expect(FormEmbedProps.safeParse({ documentId: "doc_short" }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: "frm_2rFdqyaVmzwXDtpdLHVvqb" }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: "" }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: "2rFdqyaVmzwXDtpdLHVvqb" }).success).toBe(false);
  });

  it("rejects unknown prop keys (strict)", () => {
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, url: "x" }).success).toBe(false);
  });

  it("round-trips an editor edit to another valid document id", () => {
    const props = FormEmbedProps.parse(formEmbedDefaultProps());
    const edited: unknown = { ...props, documentId: VALID_ID };
    expect(FormEmbedProps.parse(edited).documentId).toBe(VALID_ID);
  });

  it("§9.2 layout/heightMode: old docs parse unchanged and default to inline/auto", () => {
    const legacy = FormEmbedProps.parse({ documentId: VALID_ID });
    expect(legacy.layout).toBe("inline");
    expect(legacy.heightMode).toBe("auto");
    expect(legacy.fixedHeight).toBeUndefined();
  });

  it("§9.2 accepts layout/heightMode/fixedHeight and rejects bad values", () => {
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, layout: "card" }).success).toBe(true);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, layout: "popup" }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, heightMode: "fixed" }).success).toBe(true);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, heightMode: "fill" }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, heightMode: "fixed", fixedHeight: 640 }).success).toBe(true);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, fixedHeight: 119 }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, fixedHeight: 2001 }).success).toBe(false);
    expect(FormEmbedProps.safeParse({ documentId: VALID_ID, fixedHeight: 480.5 }).success).toBe(false);
  });
});

describe("embedFrameSrc (spec §10.2 frame URL)", () => {
  it("is /embed/:documentId", () => {
    expect(embedFrameSrc(VALID_ID)).toBe(`/embed/${VALID_ID}`);
  });
});

describe("form-embed render (§9.2 layout + height modes)", () => {
  it("renders the child iframe with the document id (inline/auto defaults)", () => {
    const html = renderToStaticMarkup(
      <FormEmbedRender props={FormEmbedProps.parse({ documentId: VALID_ID })} />,
    );
    expect(html).toContain('data-block-kind="form-embed"');
    expect(html).toContain(`data-document-id="${VALID_ID}"`);
    expect(html).toContain(`src="/embed/${VALID_ID}"`);
    expect(html).toContain('data-layout="inline"');
    expect(html).toContain('data-height-mode="auto"');
    expect(html).toContain("height:480px");
  });

  it("§9.2 heightMode fixed pins the authored height", () => {
    const html = renderToStaticMarkup(
      <FormEmbedRender
        props={FormEmbedProps.parse({ documentId: VALID_ID, heightMode: "fixed", fixedHeight: 640 })}
      />,
    );
    expect(html).toContain('data-height-mode="fixed"');
    expect(html).toContain("height:640px");
  });

  it("§9.2 layout card renders a framed, centered container", () => {
    const html = renderToStaticMarkup(
      <FormEmbedRender props={FormEmbedProps.parse({ documentId: VALID_ID, layout: "card" })} />,
    );
    expect(html).toContain('data-layout="card"');
    expect(html).toContain("ff-form-embed--card");
    expect(html).toContain("max-width:480px");
    expect(html).toContain(`src="/embed/${VALID_ID}"`);
  });
});

describe("form-embed editor (§9.2 layout + height mode controls)", () => {
  const noop = (): void => {};

  it("exposes layout and height mode selects", () => {
    const html = renderToStaticMarkup(
      <FormEmbedEditor blockId="blk_embed001" props={FormEmbedProps.parse({ documentId: VALID_ID })} onChange={noop} />,
    );
    expect(html).toContain('data-kind="form-embed"');
    expect(html).toContain("Layout");
    expect(html).toContain("Height mode");
    expect(html).toContain('value="card"');
    expect(html).toContain('value="fixed"');
    // The fixed-height numeric field is hidden while heightMode is auto.
    expect(html).not.toContain("Fixed height (px)");
  });

  it("fixed heightMode reveals the fixed-height field with the authored value", () => {
    const html = renderToStaticMarkup(
      <FormEmbedEditor
        blockId="blk_embed002"
        props={FormEmbedProps.parse({ documentId: VALID_ID, heightMode: "fixed", fixedHeight: 640 })}
        onChange={noop}
      />,
    );
    expect(html).toContain("Fixed height (px)");
    expect(html).toContain('value="640"');
  });
});
