// T21 — `multi-question-page`: props are empty; the answer value is the map of
// child answers keyed by child block id (spec §7.2), validated by
// `validateChildAnswers` against the registered child question kinds.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MultiQuestionPageAnswer,
  MultiQuestionPageProps,
  childAnswerOf,
  multiQuestionPageDefaultProps,
  validateChildAnswers,
} from "./schema";
import { MultiQuestionPageRender } from "./render";
import type { Block } from "@formforge/schema";
import "../short-text"; // registers a question kind for child validation

const child: Block = {
  id: "blk_text0001",
  kind: "short-text",
  props: { label: "Name", required: false },
};
const layoutChild: Block = { id: "blk_sec0001", kind: "section", props: {} };
const unknownChild: Block = { id: "blk_unk0001", kind: "marquee", props: {} };

describe("multi-question-page props", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(MultiQuestionPageProps.parse(multiQuestionPageDefaultProps())).toEqual({});
  });

  it("rejects any props (strict)", () => {
    expect(MultiQuestionPageProps.safeParse({ title: "x" }).success).toBe(false);
  });
});

describe("multi-question-page answer map (spec §7.2)", () => {
  it("accepts a map of child answers keyed by child block id", () => {
    const answers = MultiQuestionPageAnswer.parse({ blk_text0001: "Ada", blk_other01: 42 });
    expect(childAnswerOf(answers, "blk_text0001")).toBe("Ada");
  });

  it("rejects non-map answer values", () => {
    expect(MultiQuestionPageAnswer.safeParse("Ada").success).toBe(false);
    expect(MultiQuestionPageAnswer.safeParse(42).success).toBe(false);
    expect(MultiQuestionPageAnswer.safeParse(["Ada"]).success).toBe(false);
    expect(MultiQuestionPageAnswer.safeParse(null).success).toBe(false);
  });
});

describe("validateChildAnswers", () => {
  it("accepts a valid child-answer map", () => {
    expect(validateChildAnswers([child], { blk_text0001: "Ada" })).toBeNull();
  });

  it("accepts unanswered children (requiredness is flow-level)", () => {
    expect(validateChildAnswers([child], {})).toBeNull();
    expect(validateChildAnswers([child], { blk_other01: 42 })).toBeNull();
  });

  it("rejects a child answer violating the child kind's answer schema", () => {
    expect(validateChildAnswers([child], { blk_text0001: 42 })).toMatch(/short-text/);
  });

  it("ignores unknown and non-question children", () => {
    expect(validateChildAnswers([layoutChild, unknownChild], { blk_sec0001: "x", blk_unk0001: { any: true } })).toBeNull();
  });

  it("rejects a non-map value outright", () => {
    expect(validateChildAnswers([child], "Ada")).toMatch(/map of child block ids/);
  });
});

describe("multi-question-page render", () => {
  it("renders its children inside the layout shell", () => {
    const html = renderToStaticMarkup(
      <MultiQuestionPageRender props={{}}>
        <p>child one</p>
        <p>child two</p>
      </MultiQuestionPageRender>,
    );
    expect(html).toContain('data-block-kind="multi-question-page"');
    expect(html).toContain("child one");
    expect(html).toContain("child two");
  });
});
