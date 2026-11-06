// RestorePrompt — §7.2 static-render tests (node env, no jsdom). Covers the
// restore variant (Restore + Discard), the discard-stale variant (Discard
// only + note) and the null no-op.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestorePrompt, type RestoreRequest } from "./RestorePrompt";

function render(request: RestoreRequest | null): string {
  return renderToStaticMarkup(
    h(RestorePrompt, { request, onRestore: () => {}, onDiscard: () => {} }),
  );
}

describe("<RestorePrompt> (§7.2 recovery)", () => {
  it("renders nothing without a pending recovery", () => {
    expect(render(null)).toBe("");
  });

  it("asks to restore with the edit count and offers Restore + Discard", () => {
    const html = render({ kind: "restore", editCount: 3 });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Restore unsaved changes"');
    expect(html).toContain("Restore unsaved changes (3 edits)?");
    expect(html).toContain("never reached the server");
    expect(html).toContain(">Restore</button>");
    expect(html).toContain(">Discard</button>");
    // Restore is the default-focus action.
    expect(html).toContain('data-ff-default-focus="true"');
  });

  it("uses singular copy for a single edit", () => {
    expect(render({ kind: "restore", editCount: 1 })).toContain("Restore unsaved changes (1 edit)?");
  });

  it("shows Discard-only for a stale record with the explanatory note", () => {
    const html = render({ kind: "discard-stale", editCount: 2 });
    expect(html).toContain("Discard unsaved changes?");
    expect(html).toContain("older version of this form");
    expect(html).toContain(">Discard</button>");
    expect(html).not.toContain(">Restore</button>");
  });
});
