// Tests for the flow preview simulator + hidden/prefill helpers (T20).
// The simulator drives the SAME `@formforge/core/logic` surface the runtime
// uses (spec §15 M5: "same engine package on client and server, verified by
// a test") — this file is that verification for the builder/preview side.

import { describe, expect, it } from "vitest";
import type { DocumentBody } from "../bridge";
import { npsScenarioRules } from "./rules";
import { captureHiddenFields, hiddenFieldConfig, prefillAnswers } from "./hidden";
import { sampleAnswers, simulateFlow } from "./preview";

function npsFormBody(): DocumentBody {
  return {
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
      { id: "q_intro", kind: "hero", props: { title: "Welcome" } },
      { id: "q_nps", kind: "nps", props: { label: "How likely to recommend?" } },
      { id: "q_comment", kind: "long-text", props: { label: "What went wrong?" } },
    ],
    endings: [
      { id: "end_a", title: "Ending A" },
      { id: "end_b", title: "Ending B" },
    ],
    logic: { rules: npsScenarioRules("q_nps", "end_a", "end_b") },
  };
}

describe("simulateFlow — 'If NPS ≤ 6 go to ending B, otherwise ending A'", () => {
  it("routes NPS 4 to ending B through the T13 engine (goto skips q_comment)", () => {
    const sim = simulateFlow(npsFormBody(), { q_nps: 4, q_comment: "broken" });
    expect(sim.ending).toBe("end:end_b");
    expect(sim.truncated).toBe(false);
    expect(sim.steps.map((s) => s.blockId)).toEqual(["q_nps"]);
    expect(sim.steps[0]?.next).toBe("end:end_b");
  });

  it("routes NPS 9 through the fallback rule to ending A", () => {
    const sim = simulateFlow(npsFormBody(), { q_nps: 9, q_comment: "great" });
    expect(sim.ending).toBe("end:end_a");
    expect(sim.steps.map((s) => s.blockId)).toEqual(["q_nps"]);
  });

  it("routes the boundary score 6 to ending B and 7 to ending A", () => {
    expect(simulateFlow(npsFormBody(), { q_nps: 6 }).ending).toBe("end:end_b");
    expect(simulateFlow(npsFormBody(), { q_nps: 7 }).ending).toBe("end:end_a");
  });

  it("feeds @hidden conditions from the hidden context", () => {
    const body = npsFormBody();
    body.logic = {
      rules: [
        {
          id: "r_utm",
          scope: "q_nps",
          when: [{ left: "@hidden:utm_source", op: "eq", right: "twitter" }],
          then: [{ type: "goto", target: "end:end_b" }],
          isFallback: false,
        },
      ],
    };
    expect(simulateFlow(body, { q_nps: 9 }, { hidden: { utm_source: "twitter" } }).ending).toBe(
      "end:end_b",
    );
    expect(simulateFlow(body, { q_nps: 9 }, { hidden: { utm_source: "newsletter" } }).ending).toBe(
      "end:end_a",
    );
  });

  it("prefills answers from URL params before the walk", () => {
    const body = npsFormBody();
    body.blocks[1]!.props.prefillParam = "nps";
    const sim = simulateFlow(body, {}, { urlParams: { nps: "3" } });
    // Prefilled "3" coerces against the ≤ 6 rule → ending B.
    expect(sim.ending).toBe("end:end_b");
  });

  it("returns the default ending path when no rules exist", () => {
    const body = npsFormBody();
    body.logic = { rules: [] };
    const sim = simulateFlow(body, { q_nps: 5, q_comment: "hi" });
    expect(sim.ending).toBe("end:end_a");
    expect(sim.steps.map((s) => s.blockId)).toEqual(["q_nps", "q_comment"]);
  });

  it("flags degenerate documents (no questions) without looping", () => {
    const body = npsFormBody();
    body.blocks = [];
    const sim = simulateFlow(body, {});
    expect(sim.ending).toBe("end:end_a"); // start scope falls to end:<first>
    expect(sim.steps).toEqual([]);
  });
});

describe("sampleAnswers", () => {
  it("provides one plausible answer per question kind, overrides win", () => {
    const body = npsFormBody();
    const answers = sampleAnswers(body, { q_nps: 4 });
    expect(answers.q_nps).toBe(4);
    expect(answers.q_comment).toBe("Something worth reading.");
  });
});

describe("captureHiddenFields", () => {
  it("captures the standard UTM set from search params", () => {
    const hidden = captureHiddenFields(
      new URLSearchParams(
        "utm_source=twitter&utm_medium=social&utm_campaign=launch&utm_term=faq&utm_content=banner&noise=1",
      ),
    );
    expect(hidden).toEqual({
      utm_source: "twitter",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_term: "faq",
      utm_content: "banner",
    });
  });

  it("accepts plain objects and drops empty values", () => {
    expect(captureHiddenFields({ utm_source: "x", utm_medium: "" })).toEqual({ utm_source: "x" });
  });

  it("honors configured extras from settings.hiddenFields", () => {
    const body = npsFormBody();
    body.settings.hiddenFields = [{ name: "referrer" }];
    expect(hiddenFieldConfig(body).map((f) => f.name)).toEqual([
      ...hiddenFieldConfig(npsFormBody()).map((f) => f.name),
      "referrer",
    ]);
    expect(captureHiddenFields({ utm_source: "x", referrer: "y" }, body)).toEqual({
      utm_source: "x",
      referrer: "y",
    });
  });
});

describe("prefillAnswers (per-question prefill via URL param)", () => {
  it("maps prefillParam params to question answers", () => {
    const body = npsFormBody();
    body.blocks[0]!.props.prefillParam = "email";
    body.blocks[2]!.props.prefillParam = "comment";
    const prefilled = prefillAnswers(body, { email: "ana@example.com", comment: "hi" });
    expect(prefilled).toEqual({ q_intro: "ana@example.com", q_comment: "hi" });
  });

  it("ignores empty and unmatched params, recurses into layout children", () => {
    const body = npsFormBody();
    body.blocks[0] = {
      id: "sec1",
      kind: "section",
      props: {},
      children: [{ id: "q_inner", kind: "email", props: { prefillParam: "email" } }],
    };
    expect(prefillAnswers(body, { email: "ana@example.com", unknown: "1" })).toEqual({
      q_inner: "ana@example.com",
    });
    expect(prefillAnswers(body, { email: "" })).toEqual({});
  });

  it("accepts URLSearchParams", () => {
    const body = npsFormBody();
    body.blocks[1]!.props.prefillParam = "nps";
    expect(prefillAnswers(body, new URLSearchParams("nps=2"))).toEqual({ q_nps: "2" });
  });
});
