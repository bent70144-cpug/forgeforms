import { describe, expect, it } from "vitest";
import { formatAnswerCell, questionColumnsFromDocument, SYSTEM_COLUMN_IDS, type BlockLike } from "./columns";
import type { QuestionColumn } from "./columns";

const QUESTION_ID = "q1a2b3c4d5";
const SELECT_ID = "qsel000001";

const documentBlocks: BlockLike[] = [
  { id: "hero1", kind: "hero", props: { title: "Welcome" } },
  {
    id: "sec1",
    kind: "section",
    children: [
      { id: QUESTION_ID, kind: "short-text", props: { label: "Full name" } },
      {
        id: "col1",
        kind: "columns",
        children: [
          {
            id: SELECT_ID,
            kind: "single-select",
            props: {
              label: "Plan",
              options: [
                { id: "opt_free", label: "Free" },
                { id: "opt_pro", label: "Pro" },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: "mqp1",
    kind: "multi-question-page",
    children: [{ id: "qemail1", kind: "email", props: { label: "Work email" } }],
  },
  { id: "qhidden1", kind: "short-text", props: { label: "Hidden" }, hidden: true },
  { id: "text1", kind: "text", props: { richText: "<p>not a question</p>" } },
];

describe("questionColumnsFromDocument", () => {
  it("prepends system columns then one column per question block in document order", () => {
    const columns = questionColumnsFromDocument(documentBlocks);
    expect(columns.map((column) => column.id)).toEqual([
      SYSTEM_COLUMN_IDS.submissionId,
      SYSTEM_COLUMN_IDS.submittedAt,
      SYSTEM_COLUMN_IDS.status,
      QUESTION_ID,
      SELECT_ID,
      "qemail1",
    ]);
  });

  it("recurses into section/columns/multi-question-page containers", () => {
    const columns = questionColumnsFromDocument(documentBlocks, { systemColumns: false });
    // q1a2b3c4d5 sits inside section > direct, qsel000001 inside columns, qemail1 inside multi-question-page
    expect(columns.map((column) => column.id)).toEqual([QUESTION_ID, SELECT_ID, "qemail1"]);
  });

  it("skips hidden blocks and non-question (content) blocks", () => {
    const columns = questionColumnsFromDocument(documentBlocks, { systemColumns: false });
    expect(columns.map((column) => column.id)).not.toContain("qhidden1");
    expect(columns.map((column) => column.id)).not.toContain("text1");
    expect(columns.map((column) => column.id)).not.toContain("hero1");
  });

  it("uses block ids as stable headers and captures label/options metadata", () => {
    const columns = questionColumnsFromDocument(documentBlocks, { systemColumns: false });
    const select = columns.find((column) => column.id === SELECT_ID) as QuestionColumn | undefined;
    expect(select?.header).toBe(SELECT_ID);
    expect(select?.label).toBe("Plan");
    expect(select?.options).toEqual([
      { id: "opt_free", label: "Free" },
      { id: "opt_pro", label: "Pro" },
    ]);
  });
});

describe("formatAnswerCell", () => {
  const selectColumn: QuestionColumn = {
    id: SELECT_ID,
    header: SELECT_ID,
    options: [
      { id: "opt_free", label: "Free" },
      { id: "opt_pro", label: "Pro" },
    ],
  };

  it("resolves single-select optionId to its label", () => {
    expect(formatAnswerCell({ optionId: "opt_pro" }, selectColumn)).toBe("Pro");
  });

  it("falls back to the raw optionId when unknown", () => {
    expect(formatAnswerCell({ optionId: "opt_gone" }, selectColumn)).toBe("opt_gone");
  });

  it("renders the free-text 'other' answer", () => {
    expect(formatAnswerCell({ other: "Custom plan" }, selectColumn)).toBe("Custom plan");
  });

  it("joins multi-select optionIds as labels", () => {
    expect(formatAnswerCell({ optionIds: ["opt_pro", "opt_free", "x"] }, selectColumn)).toBe("Pro; Free; x");
  });

  it("joins file-upload assetIds", () => {
    expect(formatAnswerCell({ assetIds: ["ast_1", "ast_2"] }, { id: "qfile" })).toBe("ast_1; ast_2");
  });

  it("passes plain values through the default formatter", () => {
    expect(formatAnswerCell("hello", { id: "q1" })).toBe("hello");
    expect(formatAnswerCell(42, { id: "q1" })).toBe("42");
    expect(formatAnswerCell(null, { id: "q1" })).toBe("");
    expect(formatAnswerCell(undefined, { id: "q1" })).toBe("");
    expect(formatAnswerCell(new Date("2026-11-05T00:00:00.000Z"), { id: "submitted_at" })).toBe(
      "2026-11-05T00:00:00.000Z",
    );
  });
});
