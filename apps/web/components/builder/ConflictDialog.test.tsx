// ConflictDialog — §7.3.3 static-render tests (node env, no jsdom). The
// focus-default behavior is pinned via the data-ff-default-focus marker (real
// focus needs a DOM effect); resolution wiring is a plain callback prop.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConflictEvent } from "@/lib/builder/autosave";
import { emptyBody } from "@/lib/builder/ops";
import { ConflictDialog } from "./ConflictDialog";

const conflict: ConflictEvent = {
  rev: 9,
  serverDoc: { meta: { title: "Server title" }, body: emptyBody("form") },
  serverBody: emptyBody("form"),
  pendingOps: [{ op: "meta.update", patch: { title: "Mine" } }],
};

function render(event: ConflictEvent | null): string {
  return renderToStaticMarkup(h(ConflictDialog, { conflict: event, onResolve: () => {} }));
}

describe("<ConflictDialog> (§7.3.3)", () => {
  it("renders nothing without an active conflict", () => {
    expect(render(null)).toBe("");
  });

  it("renders the required dialog copy and a11y roles", () => {
    const html = render(conflict);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Conflict"');
    expect(html).toContain("This form was changed in another tab or by someone else.");
  });

  it("offers Keep mine / Use theirs and a disabled Compare (Coming soon)", () => {
    const html = render(conflict);
    expect(html).toContain("Keep mine");
    expect(html).toContain("Use theirs");
    const compare = html.match(/<button[^>]*>Compare<\/button>/)?.[0] ?? "";
    expect(compare).toContain("disabled");
    expect(html).toContain('title="Coming soon"');
    // Default focus lands on the safe choice ("Use theirs").
    expect(html).toContain('data-ff-default-focus="true"');
  });

  it("counts the kept local changes when pending ops exist", () => {
    expect(render(conflict)).toContain("1 unsaved change is kept");
  });

  it("falls back to generic copy with an empty pending queue", () => {
    const html = render({ ...conflict, pendingOps: [] });
    expect(html).not.toContain("unsaved change");
    expect(html).toContain("Your changes are kept on this device.");
  });
});
