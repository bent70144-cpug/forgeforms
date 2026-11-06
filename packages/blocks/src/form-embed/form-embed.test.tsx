// T21 — `form-embed` schema + render: documentId of a published form; renders
// the /embed/:documentId iframe (spec §10.2) with ff:height / ff:complete
// postMessage forwarding upward. Protocol guard tests live in
// ../shared/embed-protocol.test.ts; the live parent listens on the harness page
// (apps/web/app/dev/form-embed-harness).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCUMENT_ID_PATTERN, FormEmbedProps, embedFrameSrc, formEmbedDefaultProps } from "./schema";
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
});

describe("embedFrameSrc (spec §10.2 frame URL)", () => {
  it("is /embed/:documentId", () => {
    expect(embedFrameSrc(VALID_ID)).toBe(`/embed/${VALID_ID}`);
  });
});

describe("form-embed render", () => {
  it("renders the child iframe with the document id", () => {
    const html = renderToStaticMarkup(<FormEmbedRender props={{ documentId: VALID_ID }} />);
    expect(html).toContain('data-block-kind="form-embed"');
    expect(html).toContain(`data-document-id="${VALID_ID}"`);
    expect(html).toContain(`src="/embed/${VALID_ID}"`);
  });
});
