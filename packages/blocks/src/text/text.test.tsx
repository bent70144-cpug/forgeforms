// Follow-up #6 — `text` block (§9.4): Tiptap JSON schema, sanitizer round-trip,
// sanitized renderer output. Editor interaction tests live in editor.test.tsx.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { sanitizeRichTextHtml } from "@formforge/core/documents/sanitize";
import { listBlockDefs } from "../registry";
import "./index"; // import = register (§7.1)
import { TextRender } from "./render";
import {
  TextProps,
  isRichTextDoc,
  paragraphDoc,
  plainTextFromRichText,
  textDefaultProps,
} from "./schema";

// A doc exactly as StarterKit's getJSON() emits it after exercising the whole
// minimal toolbar: bold, italic, strike, bullet list, ordered list, link.
const EDITOR_STYLE_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Bold",
          marks: [
            { type: "bold" },
            { type: "italic" },
            { type: "strike" },
          ],
        },
        { type: "hardBreak" },
        { type: "text", text: "linked", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] },
      ],
    },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
  ],
} as const;

describe("text props schema (Tiptap JSON mirror)", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = TextProps.parse(textDefaultProps());
    expect(props.richText).toEqual(paragraphDoc("Write something…"));
  });

  it("accepts a full editor-style Tiptap doc (marks, lists, heading, link)", () => {
    const parsed = TextProps.safeParse({ richText: EDITOR_STYLE_DOC });
    expect(parsed.success).toBe(true);
  });

  it("accepts Tiptap's empty-doc shapes (no content / empty paragraph)", () => {
    expect(TextProps.safeParse({ richText: { type: "doc", content: [] } }).success).toBe(true);
    expect(TextProps.safeParse({ richText: { type: "doc" } }).success).toBe(true);
    expect(TextProps.safeParse({ richText: { type: "doc", content: [{ type: "paragraph" }] } }).success).toBe(true);
  });

  it("accepts the sanitized HTML string form (§17 save-path storage)", () => {
    expect(TextProps.safeParse({ richText: "<p>ok</p>" }).success).toBe(true);
    expect(TextProps.safeParse({ richText: "Changed" }).success).toBe(true); // AI vocabulary
    expect(TextProps.safeParse({ richText: "" }).success).toBe(true);
  });

  it("rejects node types outside the sanitizer allowlist", () => {
    const doc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "x" } }],
    };
    expect(TextProps.safeParse({ richText: doc }).success).toBe(false);
  });

  it("rejects marks outside the sanitizer allowlist", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "highlight" }] }] },
      ],
    };
    expect(TextProps.safeParse({ richText: doc }).success).toBe(false);
  });

  it("rejects a heading level out of range", () => {
    const doc = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "x" }] }],
    };
    expect(TextProps.safeParse({ richText: doc }).success).toBe(false);
  });

  it("rejects non-string non-doc richText and oversized HTML strings", () => {
    expect(TextProps.safeParse({ richText: 42 }).success).toBe(false);
    expect(TextProps.safeParse({ richText: "x".repeat(200_001) }).success).toBe(false);
  });

  it("rejects unknown prop keys (strict)", () => {
    expect(TextProps.safeParse({ richText: "<p>x</p>", bogus: 1 }).success).toBe(false);
  });

  it("round-trips through its own schema (parse output re-parses identically)", () => {
    const once = TextProps.parse({ richText: EDITOR_STYLE_DOC });
    const twice = TextProps.parse(once);
    expect(twice).toEqual(once);
  });
});

describe("text helpers", () => {
  it("isRichTextDoc distinguishes the JSON form from strings", () => {
    expect(isRichTextDoc({ type: "doc" })).toBe(true);
    expect(isRichTextDoc("<p>x</p>")).toBe(false);
    expect(isRichTextDoc(null)).toBe(false);
  });

  it("plainTextFromRichText extracts label text from docs and strips tags from strings", () => {
    expect(plainTextFromRichText(EDITOR_STYLE_DOC)).toBe("Bold linked One Two Heading");
    expect(plainTextFromRichText("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
    expect(plainTextFromRichText(undefined)).toBe("");
  });
});

describe("text registered def", () => {
  const def = listBlockDefs().find((d) => d.kind === "text");
  if (def === undefined) throw new Error("block text not registered");

  it("is a content block without answerSchema, wired to TextProps", () => {
    expect(def.family).toBe("content");
    expect(def.answerSchema).toBeUndefined();
    expect(def.propsSchema).toBe(TextProps);
    expect(def.defaultProps).toBe(textDefaultProps);
  });

  it("defaultProps satisfy propsSchema (registry proof, re-asserted)", () => {
    expect(TextProps.safeParse(def.defaultProps()).success).toBe(true);
  });
});

describe("text renderer — sanitized output only", () => {
  const markup = (richText: unknown): string => {
    const props = TextProps.parse({ richText });
    return renderToStaticMarkup(<TextRender props={props} />);
  };

  it("serializes Tiptap JSON to allowlist HTML", () => {
    const html = markup(EDITOR_STYLE_DOC);
    expect(html).toContain("<p><strong><em><s>Bold</s></em></strong><br>");
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer nofollow">linked</a>');
    expect(html).toContain("<ul><li><p>One</p></li></ul>");
    expect(html).toContain("<ol><li><p>Two</p></li></ol>");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain('data-block-kind="text"');
  });

  it("strips scripts and handlers from HTML strings (script-proof boundary)", () => {
    const html = markup("<p>safe</p><script>alert(1)</script><img src=x onerror=alert(1)>");
    expect(html).toContain("<p>safe</p>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
  });

  it("drops javascript: hrefs from HTML strings", () => {
    const html = markup('<a href="javascript:alert(1)">click</a>');
    expect(html).toContain("<a>click</a>");
    expect(html).not.toContain("javascript:");
  });

  it("renders nothing for empty rich text", () => {
    expect(markup("")).toBe("");
    expect(markup({ type: "doc", content: [] })).toBe("");
  });

  it("sanitizer round-trip: sanitize(JSON) === sanitize(sanitized HTML) (idempotent)", () => {
    const html = sanitizeRichTextHtml(EDITOR_STYLE_DOC);
    expect(html).toBe(sanitizeRichTextHtml(html));
    // And the rendered markup embeds exactly that sanitizer output.
    expect(markup(EDITOR_STYLE_DOC)).toContain(html);
  });

  it("sanitizer round-trip: the §17 save path flattens JSON to a string the schema accepts", () => {
    // crud.ts stores sanitizeRichTextHtml(richText); the stored string must
    // still satisfy TextProps (schema union) and render identically.
    const stored = sanitizeRichTextHtml(EDITOR_STYLE_DOC);
    expect(TextProps.safeParse({ richText: stored }).success).toBe(true);
    expect(renderToStaticMarkup(<TextRender props={{ richText: stored }} />)).toContain("<ul>");
  });
});
