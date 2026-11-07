// preview.test.ts — pure unit tests for the §8.4 preview mapping helpers
// (vitest node env, no DOM, no React): parsePrefillParams + buildPreviewInput
// + device widths. The renderer mount itself is NOT covered here (node env).
import { describe, expect, it } from "vitest";
import type { Block, DocumentBody } from "../bridge";
import { emptyBody } from "./ops";
import { buildPreviewInput, parsePrefillParams, PREVIEW_DEVICE_WIDTHS } from "./preview";

const b = (id: string, props: Record<string, unknown> = {}, kind = "short-text"): Block => ({
  id,
  kind,
  props,
});

const meta = { title: "Product feedback", slug: "product-feedback" };

/** Minimal DocumentBody fixture in the ops.test.ts style (emptyBody + blocks). */
function fixtureBody(): DocumentBody {
  return {
    ...emptyBody("form"),
    blocks: [
      b("q1", { label: "Your name", required: true, prefillParam: "name" }),
      b("q2", { label: "Where should we reply?", required: true }, "email"),
    ],
    endings: [{ id: "end1", title: "Thanks!" }],
    logic: {
      rules: [
        {
          id: "r1",
          scope: "start",
          when: [{ left: "@block:q1", op: "isEmpty" }],
          then: [{ type: "goto", target: "end1" }],
          isFallback: false,
        },
      ],
    },
  };
}

describe("parsePrefillParams", () => {
  it("parses plain k=v pairs", () => {
    expect(parsePrefillParams("email=test@x.io&name=Ada")).toEqual({
      email: "test@x.io",
      name: "Ada",
    });
  });

  it("strips a single leading ?", () => {
    expect(parsePrefillParams("?email=test@x.io")).toEqual({ email: "test@x.io" });
    expect(parsePrefillParams("??weird=1")).toEqual({ "?weird": "1" });
  });

  it("decodes %XX escapes and + as space", () => {
    expect(parsePrefillParams("email=ada%40lovelace.io")).toEqual({ email: "ada@lovelace.io" });
    expect(parsePrefillParams("name=Ada+Lovelace")).toEqual({ name: "Ada Lovelace" });
    expect(parsePrefillParams("q=a%20b")).toEqual({ q: "a b" });
  });

  it("ignores malformed pairs: no '=', empty key, empty segments", () => {
    expect(parsePrefillParams("justakey")).toEqual({});
    expect(parsePrefillParams("=value&ok=1&=another")).toEqual({ ok: "1" });
    expect(parsePrefillParams("&&ok=1&&")).toEqual({ ok: "1" });
    expect(parsePrefillParams("?")).toEqual({});
  });

  it("keeps raw text for invalid % escapes instead of throwing", () => {
    expect(parsePrefillParams("k=%ZZ&ok=1")).toEqual({ k: "%ZZ", ok: "1" });
    expect(parsePrefillParams("k=100%")).toEqual({ k: "100%" });
  });

  it("last occurrence wins for repeated keys", () => {
    expect(parsePrefillParams("name=Ada&name=Grace")).toEqual({ name: "Grace" });
  });

  it("returns {} for empty / whitespace input", () => {
    expect(parsePrefillParams("")).toEqual({});
    expect(parsePrefillParams("   ")).toEqual({});
  });
});

describe("buildPreviewInput", () => {
  it("maps the draft onto the renderer input shape", () => {
    const body = fixtureBody();
    const input = buildPreviewInput(body, meta, { name: "Ada" });

    expect(input.documentId).toBe("product-feedback");
    expect(input.urlParams).toEqual({ name: "Ada" });

    // Document projection — key fields the renderer reads.
    expect(input.document.schemaVersion).toBe(1);
    expect(input.document.type).toBe("form");
    expect(input.document.title).toBe("Product feedback");
    expect(input.document.blocks.map((x) => x.id)).toEqual(["q1", "q2"]);
    expect(input.document.blocks[0]?.kind).toBe("short-text");
    expect(input.document.blocks[0]?.props).toEqual({
      label: "Your name",
      required: true,
      prefillParam: "name",
    });
    expect(input.document.endings.map((e) => e.id)).toEqual(["end1"]);
    expect(input.document.logic?.rules.map((r) => r.id)).toEqual(["r1"]);
    expect(input.document.settings?.progressBar).toBe(true);
    expect(input.document.settings?.autoAdvance).toBe(true);
    expect(input.document.theme?.radius).toBe("md");
  });

  it("falls back to a cosmetic draft id when no slug exists", () => {
    const input = buildPreviewInput(fixtureBody(), { title: "Draft" }, {});
    expect(input.documentId).toBe("draft-preview");
  });

  it("passes urlParams through unchanged (prefill seeds draft answers, §7.2)", () => {
    const params = { email: "a@x.io", name: "Ada Lovelace" };
    const input = buildPreviewInput(fixtureBody(), meta, params);
    expect(input.urlParams).toBe(params);
  });

  it("does not leak server-only settings extras into the renderer document", () => {
    const input = buildPreviewInput(fixtureBody(), meta, {});
    expect("notifyEmails" in (input.document.settings ?? {})).toBe(false);
    expect("retentionDays" in (input.document.settings ?? {})).toBe(false);
    expect("hiddenFields" in (input.document.settings ?? {})).toBe(false);
    expect("seo" in (input.document.settings ?? {})).toBe(false);
    expect("welcome" in input.document).toBe(false);
  });

  it("keeps empty meta titles out of the document (renderer falls back)", () => {
    const input = buildPreviewInput(fixtureBody(), { title: "" }, {});
    expect(input.document.title).toBeUndefined();
  });
});

describe("PREVIEW_DEVICE_WIDTHS", () => {
  it("desktop is fluid, mobile constrains to a 390px frame", () => {
    expect(PREVIEW_DEVICE_WIDTHS.desktop).toBeNull();
    expect(PREVIEW_DEVICE_WIDTHS.mobile).toBe(390);
  });
});
