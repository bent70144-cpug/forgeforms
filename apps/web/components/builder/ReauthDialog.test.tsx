// ReauthDialog — §7.1 follow-up #3 static-render tests (node env, no jsdom).
// The focus-default behavior is pinned via the data-ff-default-focus marker
// (real focus needs a DOM effect); resume/dismiss wiring is plain callbacks.
// Queue parking/resuming itself is covered by lib/builder/autosave.test.ts.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnauthenticatedEvent } from "@/lib/builder/autosave";
import { ReauthDialog } from "./ReauthDialog";

const prompt: UnauthenticatedEvent = { pendingCount: 3 };

function render(event: UnauthenticatedEvent | null, signInHref?: string): string {
  return renderToStaticMarkup(
    h(ReauthDialog, {
      prompt: event,
      ...(signInHref !== undefined ? { signInHref } : {}),
      onResume: () => Promise.resolve(true),
      onDismiss: () => {},
    }),
  );
}

describe("<ReauthDialog> (§7.1 follow-up #3)", () => {
  it("renders nothing without an active re-auth prompt", () => {
    expect(render(null)).toBe("");
  });

  it("renders the required dialog copy and a11y roles", () => {
    const html = render(prompt);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Session expired"');
    expect(html).toContain("Your session expired, so FormForge stopped saving. Nothing was lost.");
    expect(html).toContain("Sign in");
    expect(html).toContain("I&#x27;ve signed in — resume");
    expect(html).toContain("Dismiss");
  });

  it("links the existing sign-in route in a new tab so builder state persists", () => {
    const html = render(prompt);
    const link = html.match(/<a[^>]*>Sign in<\/a>/)?.[0] ?? "";
    expect(link).toContain('href="/login"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    // Default focus lands on the required first step (sign in).
    expect(link).toContain('data-ff-default-focus="true"');
  });

  it("honors a custom sign-in route", () => {
    expect(render(prompt, "/auth/login")).toContain('href="/auth/login"');
  });

  it("counts the kept local changes when pending ops exist", () => {
    expect(render(prompt)).toContain("Your 3 unsaved changes are kept on this device");
  });

  it("uses singular copy for one kept change and generic copy for none", () => {
    expect(render({ pendingCount: 1 })).toContain("Your 1 unsaved change is kept on this device");
    expect(render({ pendingCount: 0 })).toContain("Your changes are kept on this device");
  });
});
