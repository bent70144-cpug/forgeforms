// T21 — catalog round-trip: every registered block (T06 + T21) parses its
// defaultProps, round-trips idempotently, and renders Editor + Render without
// error (acceptance: "All blocks render from defaultProps without error; props
// schemas round-trip through editor").
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { listBlockDefs } from "./registry";
import "./index"; // import = register everything

const T21_KINDS = [
  "gallery",
  "video",
  "testimonials",
  "faq",
  "pricing",
  "projects",
  "contact-links",
  "section",
  "columns",
  "multi-question-page",
  "form-embed",
] as const;

const markup = (node: ReactNode): string => renderToStaticMarkup(<>{node}</>);

describe("block catalog (T06 + T21)", () => {
  const defs = listBlockDefs();

  it("registers every T21 §7.2 kind", () => {
    const kinds = defs.map((d) => d.kind);
    for (const kind of T21_KINDS) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it("keeps the §7.2 families", () => {
    const byKind = new Map(defs.map((d) => [d.kind, d]));
    expect(byKind.get("gallery")?.family).toBe("content");
    expect(byKind.get("video")?.family).toBe("content");
    expect(byKind.get("testimonials")?.family).toBe("content");
    expect(byKind.get("faq")?.family).toBe("content");
    expect(byKind.get("pricing")?.family).toBe("content");
    expect(byKind.get("projects")?.family).toBe("content");
    expect(byKind.get("contact-links")?.family).toBe("content");
    expect(byKind.get("section")?.family).toBe("layout");
    expect(byKind.get("columns")?.family).toBe("layout");
    expect(byKind.get("multi-question-page")?.family).toBe("layout");
    expect(byKind.get("form-embed")?.family).toBe("action");
  });

  it("never gives T21 content/layout/action blocks an answerSchema", () => {
    for (const kind of T21_KINDS) {
      expect(getDef(kind).answerSchema, kind).toBeUndefined();
    }
  });

  it("defaultProps parse and round-trip idempotently for every block", () => {
    for (const def of defs) {
      const once = def.propsSchema.parse(def.defaultProps());
      const twice = def.propsSchema.parse(once);
      expect(twice, def.kind).toEqual(once);
    }
  });

  it("Editor renders without error from defaultProps for every block", () => {
    for (const def of defs) {
      const Editor = def.Editor;
      const html = markup(
        <Editor blockId={`blk_${def.kind}`} props={def.propsSchema.parse(def.defaultProps())} onChange={() => {}} />,
      );
      expect(html, def.kind).not.toBe("");
    }
  });

  it("Render renders without error from defaultProps for every block", () => {
    for (const def of defs) {
      const Render = def.Render;
      const html = markup(
        <Render props={def.propsSchema.parse(def.defaultProps())} />,
      );
      expect(html, def.kind).not.toBe("");
    }
  });
});

function getDef(kind: string) {
  const def = listBlockDefs().find((d) => d.kind === kind);
  if (def === undefined) throw new Error(`block ${kind} not registered`);
  return def;
}
