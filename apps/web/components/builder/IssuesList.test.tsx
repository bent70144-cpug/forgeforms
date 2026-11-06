// B7 — IssuesList static-render tests (spec §8.1 document-level drawer).
// Node env, react-dom/server — markup assertions only; the grouping itself is
// unit-tested in lib/builder/publish.test.ts (groupIssues).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IssuesList, issuesSummary } from "./IssuesList";
import { ISSUE_CODES, type ValidationIssue } from "@/lib/builder/publish";

function issue(patch: Partial<ValidationIssue>): ValidationIssue {
  return {
    code: ISSUE_CODES.emptyLabel,
    message: "This short answer question has no label.",
    blockId: "q1",
    path: "blocks[0].props.label",
    level: "error",
    ...patch,
  };
}

const fixture: ValidationIssue[] = [
  issue({ code: ISSUE_CODES.badUrl, message: "The ending redirect must be a valid https:// URL.", blockId: null, path: "endings[0].redirectUrl" }),
  issue({}),
  issue({
    code: ISSUE_CODES.sensitiveField,
    message: "Label appears to collect password data.",
    blockId: "q1",
    level: "warning",
  }),
];

function render(issues: ValidationIssue[], open = true): string {
  return renderToStaticMarkup(
    h(IssuesList, {
      open,
      issues,
      onClose: () => {},
      goTo: () => {},
      labelFor: (id) => (id === "q1" ? "Your name" : undefined),
    }),
  );
}

describe("<IssuesList>", () => {
  it("renders nothing while closed", () => {
    expect(render(fixture, false)).toBe("");
  });

  it("renders a labelled modal dialog drawer with a polite count line", () => {
    const html = render(fixture);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Publish issues"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("2 blocking issues, 1 warning");
  });

  it("groups document-level issues first, then blocks by display label", () => {
    const html = render(fixture);
    expect(html).toContain("Document");
    expect(html).toContain("Your name");
  });

  it("falls back to Block <id> when the label is unknown", () => {
    expect(render([issue({ blockId: "zz" })])).toContain("Block zz");
  });

  it("shows code chips, messages and Go to buttons for block issues only", () => {
    const html = render(fixture);
    expect(html).toContain(ISSUE_CODES.badUrl);
    expect(html).toContain(ISSUE_CODES.emptyLabel);
    expect(html).toContain(ISSUE_CODES.sensitiveField);
    const gotoCount = (html.match(/Go to/g) ?? []).length;
    expect(gotoCount).toBe(2); // q1 issues only — document-level has no Go to
    expect(html).toContain('data-code="EMPTY_LABEL"');
  });

  it("styles warnings amber and adds the §8.1 abuse-policy note", () => {
    const html = render(fixture);
    expect(html).toContain("ff-pub-issue--warning");
    expect(html).toContain("FormForge must not be used to collect regulated secrets");
  });

  it("shows an empty state when there is nothing to fix", () => {
    const html = render([]);
    expect(html).toContain("No issues — ready to publish.");
  });

  it("exposes the summary used by the aria-live line (unit)", () => {
    expect(issuesSummary([])).toBe("No issues — ready to publish.");
    expect(issuesSummary([issue({})])).toBe("1 blocking issue");
    expect(
      issuesSummary([
        issue({}),
        issue({ blockId: null }),
        issue({ code: ISSUE_CODES.sensitiveField, level: "warning" }),
        issue({ code: ISSUE_CODES.sensitiveField, level: "warning", blockId: null }),
      ]),
    ).toBe("2 blocking issues, 2 warnings");
  });
});
