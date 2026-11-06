import { describe, expect, it } from "vitest";
import { DocumentBody, createEmptyDocumentBody } from "./document";
import { documentIssuesFromZodError, formatZodPath } from "./errors";
import { DEFAULT_THEME } from "./theme";
import {
  buttonBlockFixture,
  heroBlockFixture,
  parsedValidDocumentBodyFixture,
  shortTextBlockFixture,
  validDocumentBodyFixture,
} from "./fixtures";

describe("DocumentBody (spec §7 golden tests)", () => {
  it("parses a valid document containing hero + short-text + button", () => {
    const doc = DocumentBody.parse(validDocumentBodyFixture());
    expect(doc.schemaVersion).toBe(1);
    expect(doc.type).toBe("form");
    expect(doc.blocks.map((b) => b.kind)).toEqual(["hero", "short-text", "button"]);
    expect(doc.blocks.map((b) => b.id)).toEqual([
      heroBlockFixture.id,
      shortTextBlockFixture.id,
      buttonBlockFixture.id,
    ]);
  });

  it("fills defaults for settings, endings and logic", () => {
    const doc = DocumentBody.parse(validDocumentBodyFixture());
    expect(doc.settings).toEqual({
      seo: {},
      locale: "en",
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      closeAt: undefined,
      maxSubmissions: undefined,
      notifyEmails: [],
    });
    expect(doc.endings).toEqual([]);
    expect(doc.logic).toEqual({ rules: [] });
  });

  it("fills theme defaults while preserving tokens", () => {
    const doc = DocumentBody.parse(validDocumentBodyFixture());
    expect(doc.theme).toEqual({
      tokens: { "color.bg": "#fbf9f4" },
      fontHeading: "Inter",
      fontBody: "Inter",
      radius: "md",
    });
  });

  it("rejects an unknown schemaVersion with a field-level path", () => {
    const result = DocumentBody.safeParse({
      ...validDocumentBodyFixture(),
      schemaVersion: 2,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues[0]).toMatchObject({ path: "schemaVersion" });
  });

  it("rejects a missing block id with path blocks[1].id", () => {
    const body = validDocumentBodyFixture();
    const blocks = body.blocks as Array<Record<string, unknown>>;
    const noId: Record<string, unknown> = { ...shortTextBlockFixture };
    delete noId.id;
    body.blocks = [blocks[0]!, noId, blocks[2]!];
    const result = DocumentBody.safeParse(body);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues).toContainEqual({ path: "blocks[1].id", message: expect.any(String) });
  });

  it("rejects duplicate top-level block ids with path blocks[2].id", () => {
    const body = validDocumentBodyFixture();
    const blocks = body.blocks as Array<Record<string, unknown>>;
    body.blocks = [blocks[0]!, blocks[1]!, { ...blocks[2]!, id: blocks[0]!.id }];
    const result = DocumentBody.safeParse(body);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues).toContainEqual({
      path: "blocks[2].id",
      message: expect.stringContaining('Duplicate block id "blk_hero001"'),
    });
  });

  it("rejects duplicate ids nested in children with an anchored path", () => {
    const body = validDocumentBodyFixture();
    const blocks = body.blocks as Array<Record<string, unknown>>;
    body.blocks = [
      { ...blocks[0]!, children: [{ ...blocks[1]!, id: "blk_dup0001" }] },
      { ...blocks[1]!, id: "blk_dup0001" },
      blocks[2]!,
    ];
    const result = DocumentBody.safeParse(body);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues).toContainEqual({
      path: "blocks[1].id",
      message: expect.stringContaining("Duplicate block id"),
    });
  });

  it("rejects invalid settings with field-level paths", () => {
    const body = validDocumentBodyFixture();
    const settings = { maxSubmissions: 0 };
    const result = DocumentBody.safeParse({ ...body, settings });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues).toContainEqual({ path: "settings.maxSubmissions", message: expect.any(String) });
  });

  it("rejects invalid notify emails", () => {
    const result = DocumentBody.safeParse({
      ...validDocumentBodyFixture(),
      settings: { notifyEmails: ["not-an-email"] },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues[0]?.path).toBe("settings.notifyEmails[0]");
  });

  it("rejects an invalid rule operator with a field-level path", () => {
    const body = validDocumentBodyFixture();
    body.logic = {
      rules: [
        {
          id: "rule_000001",
          scope: shortTextBlockFixture.id,
          when: [{ left: "@block:blk_text0001", op: "approx", right: "x" }],
          then: [{ type: "goto", target: "end:default" }],
        },
      ],
    };
    const result = DocumentBody.safeParse(body);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = documentIssuesFromZodError(result.error);
    expect(issues[0]?.path).toBe("logic.rules[0].when[0].op");
  });

  it("accepts a valid goto/set rule body", () => {
    const body = validDocumentBodyFixture();
    body.logic = {
      rules: [
        {
          id: "rule_000001",
          scope: "start",
          when: [{ left: "@block:blk_text0001", op: "isEmpty" }],
          then: [
            { type: "goto", target: "end:bye" },
            { type: "set", var: "seen", value: true },
          ],
          isFallback: false,
        },
      ],
    };
    const doc = DocumentBody.parse(body);
    expect(doc.logic.rules[0]?.then).toHaveLength(2);
  });

  it("round-trips through JSON unchanged", () => {
    const doc = parsedValidDocumentBodyFixture();
    const serialized = JSON.stringify(doc);
    const round = DocumentBody.parse(JSON.parse(serialized));
    expect(round).toEqual(doc);
    expect(JSON.parse(serialized)).toEqual(JSON.parse(JSON.stringify(round)));
  });

  it("createEmptyDocumentBody produces a valid, fully-defaulted body", () => {
    const body = createEmptyDocumentBody("page");
    expect(body.type).toBe("page");
    expect(body.blocks).toEqual([]);
    expect(body.settings.locale).toBe("en");
    expect(body.theme).toEqual(DEFAULT_THEME);
    expect(() => DocumentBody.parse(body)).not.toThrow();
  });
});

describe("formatZodPath", () => {
  it.each([
    [[], ""],
    [["props", "title"], "props.title"],
    [["blocks", 2, "props", "title"], "blocks[2].props.title"],
    [["settings", "notifyEmails", 0], "settings.notifyEmails[0]"],
    [["blocks", 0, "children", 1, "id"], "blocks[0].children[1].id"],
  ])("formats %j as %s", (path, expected) => {
    expect(formatZodPath(path)).toBe(expected);
  });
});
