// Golden tests for the AI draft flow (spec §15 M8):
// prompt contains the §7.2 cheatsheet; valid fixture → DocumentBody;
// invalid fixture → exactly one repair attempt → clear failure.
import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/errors.ts";
import { err } from "../../shared/result.ts";;
import {
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  generateDraftBody,
  validateDraftBody,
} from "../draft";
import { AI_JSON_CONTRACT } from "../prompt";
import { FakeProvider, VALID_DRAFT_TEXT } from "./helpers";

describe("draft prompts", () => {
  it("system prompt contains the spec §7.2 block-kind cheatsheet", () => {
    const system = buildDraftSystemPrompt();
    expect(system).toContain("BLOCK KIND CHEATSHEET");
    for (const kind of [
      "hero",
      "text",
      "section",
      "multi-question-page",
      "form-embed",
      "short-text",
      "long-text",
      "email",
      "number",
      "single-select",
      "multi-select",
      "dropdown",
      "rating",
      "nps",
      "file-upload",
    ]) {
      expect(system).toContain(kind);
    }
  });

  it("system prompt pins the JSON-only contract and the DocumentBody shape", () => {
    const system = buildDraftSystemPrompt();
    expect(system).toContain(AI_JSON_CONTRACT);
    expect(system).toContain('"schemaVersion": 1');
    expect(system).toContain("unique");
  });

  it("user prompt carries the request and document type only — no answers, no secrets", () => {
    const user = buildDraftUserPrompt({
      prompt: "A customer feedback form with an NPS question",
      documentType: "form",
    });
    expect(user).toContain("A customer feedback form with an NPS question");
    expect(user).toContain("form");
    // no submission/answer data and no secrets ever enter the prompt
    expect(user).not.toContain("answers");
    expect(user).not.toContain("ANTHROPIC");
    expect(user).not.toContain("sk-");
  });
});

describe("validateDraftBody", () => {
  it("accepts a valid fixture and fills zod defaults", () => {
    const result = validateDraftBody(JSON.parse(VALID_DRAFT_TEXT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.type).toBe("form");
    expect(result.body.blocks).toHaveLength(3);
    expect(result.body.theme.radius).toBe("md");
    expect(result.body.settings.locale).toBe("en");
    expect(result.body.endings[0]?.id).toBe("e1");
  });

  it("accepts a minimal body thanks to schema defaults (settings key still required)", () => {
    const result = validateDraftBody({
      schemaVersion: 1,
      type: "page",
      theme: { tokens: {} },
      settings: {},
      blocks: [{ id: "b1", kind: "hero", props: { title: "Studio" } }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects schema violations with field-level issues", () => {
    const result = validateDraftBody({ schemaVersion: 2, type: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n")).toContain("schemaVersion");
    expect(result.issues.join("\n")).toContain("type");
  });

  it("rejects unknown block kinds (only §7.2 kinds allowed)", () => {
    const result = validateDraftBody({
      schemaVersion: 1,
      type: "form",
      theme: { tokens: {} },
      settings: {},
      blocks: [{ id: "b1", kind: "magic-block", props: {} }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n")).toContain('unknown block kind "magic-block"');
  });

  it("rejects duplicate block ids, including nested children", () => {
    const result = validateDraftBody({
      schemaVersion: 1,
      type: "page",
      theme: { tokens: {} },
      settings: {},
      blocks: [
        { id: "b1", kind: "section", props: {}, children: [{ id: "b1", kind: "text", props: {} }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n")).toContain('Duplicate block id "b1"');
  });
});

describe("generateDraftBody", () => {
  const input = { prompt: "A two-question feedback form", documentType: "form" as const };

  it("valid fixture → DocumentBody on the first attempt", async () => {
    const provider = new FakeProvider(VALID_DRAFT_TEXT);
    const result = await generateDraftBody({ provider }, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts).toBe(1);
    expect(result.value.body.blocks.map((b: { kind: string }) => b.kind)).toEqual([
      "short-text",
      "email",
      "rating",
    ]);
    expect(provider.calls).toHaveLength(1);
  });

  it("parses replies wrapped in markdown fences", async () => {
    const provider = new FakeProvider("```json\n" + VALID_DRAFT_TEXT + "\n```");
    const result = await generateDraftBody({ provider }, input);
    expect(result.ok).toBe(true);
  });

  it("invalid fixture → retries exactly once with the validation issues, then succeeds", async () => {
    const invalid = JSON.stringify({
      schemaVersion: 1,
      type: "form",
      theme: { tokens: {} },
      settings: {},
      blocks: [{ id: "b1", kind: "short-text", props: {} }, { id: "b1", kind: "nps", props: {} }],
    });
    const provider = new FakeProvider(invalid, VALID_DRAFT_TEXT);
    const result = await generateDraftBody({ provider }, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts).toBe(2);
    expect(provider.calls).toHaveLength(2);
    const repairPrompt = provider.calls[1]?.user ?? "";
    expect(repairPrompt).toContain("previous reply was invalid");
    expect(repairPrompt).toContain('Duplicate block id "b1"');
  });

  it("still invalid after the repair → clear AI_OUTPUT_INVALID failure, never a third call", async () => {
    const invalid = "not json at all";
    const provider = new FakeProvider(invalid, invalid);
    const result = await generateDraftBody({ provider }, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_OUTPUT_INVALID");
    expect(result.error.status).toBe(502);
    expect(result.error.details).toEqual([{ path: "body", message: expect.any(String) }, { path: "attempts", message: "2" }]);
    expect(provider.calls).toHaveLength(2);
  });

  it("unknown kind twice → AI_OUTPUT_INVALID listing the kind", async () => {
    const invalid = JSON.stringify({
      schemaVersion: 1,
      type: "form",
      theme: { tokens: {} },
      settings: {},
      blocks: [{ id: "b1", kind: "horoscope", props: {} }],
    });
    const provider = new FakeProvider(invalid, invalid);
    const result = await generateDraftBody({ provider }, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error.details)).toContain("horoscope");
  });

  it("provider transport errors propagate immediately without a repair attempt", async () => {
    const provider = new FakeProvider(err(new AppError("AI_PROVIDER_ERROR", "boom")));
    const result = await generateDraftBody({ provider }, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    expect(provider.calls).toHaveLength(1);
  });
});
