// Tests for edit-with-AI: ops proposals are validated against the current
// document, are never applied, and require explicit confirmation.
import { describe, expect, it } from "vitest";
import type { DocumentBody } from "../../bridge";
import { assertEditConfirmed, buildEditSystemPrompt, buildEditUserPrompt, proposeEditOps, EDIT_CONFIRMATION_TOKEN } from "../edit";
import { FakeProvider } from "./helpers";

const DOCUMENT: DocumentBody = {
  schemaVersion: 1,
  type: "form",
  theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
  settings: {
    seo: {},
    locale: "en",
    progressBar: true,
    autoAdvance: true,
    showBranding: true,
    captcha: false,
    notifyEmails: [],
  },
  blocks: [
    { id: "b1", kind: "short-text", props: { label: "Your name", required: true } },
    { id: "b2", kind: "email", props: { label: "Email", required: false } },
  ],
  endings: [{ id: "e1", title: "Thanks!" }],
  logic: { rules: [] },
};

function reply(summary: string, ops: unknown): string {
  return JSON.stringify({ summary, ops });
}

describe("edit prompts", () => {
  it("system prompt lists the §8 op vocabulary and the block cheatsheet", () => {
    const system = buildEditSystemPrompt();
    for (const fragment of [
      '"block.insert"',
      '"block.update"',
      '"block.move"',
      '"block.remove"',
      '"settings.update"',
      '"theme.update"',
      '"ending.upsert"',
      '"rule.upsert"',
      '"meta.update"',
      "short-text",
      "single-select",
    ]) {
      expect(system).toContain(fragment);
    }
  });

  it("user prompt includes the current document as context and nothing else", () => {
    // context = document structure; no answers/submissions/secrets exist here
    const user = buildEditUserPrompt({ instruction: "make name required", document: DOCUMENT });
    expect(user).toContain(JSON.stringify(DOCUMENT));
    expect(user).toContain("make name required");
    expect(user).not.toContain("answers");
  });
});

describe("proposeEditOps", () => {
  it("valid fixture → ops proposal with a reviewable diff", async () => {
    const provider = new FakeProvider(
      reply("Make the name field required", [
        { type: "block.update", id: "b1", props: { label: "Full name", required: true } },
      ]),
    );
    const result = await proposeEditOps(
      { provider },
      { instruction: "Make the name field required and relabel it", document: DOCUMENT },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ops).toHaveLength(1);
    expect(result.value.ops[0]).toMatchObject({ type: "block.update", id: "b1" });
    expect(result.value.summary).toContain("required");
    expect(result.value.diff[0]).toContain('Update short-text "b1" props (label, required)');
    expect(result.value.attempts).toBe(1);
  });

  it("returns a proposal only — the input document is never mutated", async () => {
    const provider = new FakeProvider(
      reply("Remove email", [{ type: "block.remove", id: "b2" }]),
    );
    const before = JSON.stringify(DOCUMENT);
    const result = await proposeEditOps(
      { provider },
      { instruction: "remove the email question", document: DOCUMENT },
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(DOCUMENT)).toBe(before);
    if (!result.ok) return;
    expect(result.value.ops[0]?.type).toBe("block.remove"); // proposed, NOT applied
    expect(DOCUMENT.blocks).toHaveLength(2);
  });

  it("ops referencing missing blocks → one repair attempt, then AI_OUTPUT_INVALID", async () => {
    const bad = reply("Update ghost", [{ type: "block.update", id: "b999", props: {} }]);
    const provider = new FakeProvider(bad, bad);
    const result = await proposeEditOps(
      { provider },
      { instruction: "update the ghost block", document: DOCUMENT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_OUTPUT_INVALID");
    expect(provider.calls).toHaveLength(2); // initial + ONE repair, never more
    expect(provider.calls[1]?.user).toContain('block "b999" does not exist');
  });

  it("insert with an id that already exists is rejected and repaired", async () => {
    const bad = reply("dup", [
      { type: "block.insert", index: 2, block: { id: "b1", kind: "rating", props: {} } },
    ]);
    const good = reply("insert", [
      {
        type: "block.insert",
        index: 2,
        block: { id: "b3", kind: "rating", props: { label: "Score", scale: 5 } },
      },
    ]);
    const provider = new FakeProvider(bad, good);
    const result = await proposeEditOps(
      { provider },
      { instruction: "add a rating question", document: DOCUMENT },
    );
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.user).toContain('inserted block id "b1" already exists');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ops[0]).toMatchObject({ type: "block.insert", block: { id: "b3" } });
  });

  it("rule ops with dangling goto targets are rejected", async () => {
    const bad = reply("rule", [
      {
        type: "rule.upsert",
        rule: {
          id: "r1",
          scope: "b2",
          when: [{ left: "@block:b2", op: "isEmpty" }],
          then: [{ type: "goto", target: "end:e404" }],
          isFallback: false,
        },
      },
    ]);
    const provider = new FakeProvider(bad, bad);
    const result = await proposeEditOps(
      { provider },
      { instruction: "route empty emails to the thanks ending", document: DOCUMENT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error.details)).toContain("missing ending");
  });

  it("malformed reply (ops not an array) → repair once → fail", async () => {
    const bad = JSON.stringify({ summary: "oops", ops: "just do it" });
    const provider = new FakeProvider(bad, bad);
    const result = await proposeEditOps(
      { provider },
      { instruction: "anything", document: DOCUMENT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(provider.calls).toHaveLength(2);
  });

  it("op vocabulary is closed: unknown op types are invalid", async () => {
    const bad = reply("delete everything", [{ type: "document.delete" }]);
    const provider = new FakeProvider(bad, bad);
    const result = await proposeEditOps(
      { provider },
      { instruction: "delete the document", document: DOCUMENT },
    );
    expect(result.ok).toBe(false);
  });
});

describe("confirmation guard (issue #27: AI ops never applied without user confirmation)", () => {
  it("rejects missing or wrong confirmation tokens", () => {
    expect(assertEditConfirmed(undefined).ok).toBe(false);
    expect(assertEditConfirmed("").ok).toBe(false);
    expect(assertEditConfirmed("yes").ok).toBe(false);
    const refused = assertEditConfirmed(undefined);
    if (!refused.ok) {
      expect(refused.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(refused.error.status).toBe(422);
    }
  });

  it("accepts the exact token produced by the review UI apply action", () => {
    const result = assertEditConfirmed(EDIT_CONFIRMATION_TOKEN);
    expect(result.ok).toBe(true);
    expect(EDIT_CONFIRMATION_TOKEN).toBe("user-confirmed");
  });
});
