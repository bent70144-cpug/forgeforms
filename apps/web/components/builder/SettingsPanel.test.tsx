// Settings panel smoke tests (builder spec §6.6) — react-dom/server static
// markup, node env. The harness seeds a loaded EditorState through
// BuilderProvider's `initialState` seam (renderToStaticMarkup never runs
// effects), and `initialTab` seeds the DocSettings tab for the document cases.
import { createElement as h, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getBlockDef } from "@formforge/blocks"; // importing registers all kinds (§7.1)
import type { DocumentEnvelope } from "@/lib/bridge";
import { DEFAULT_THEME_TOKENS } from "@/lib/bridge";
import { initialEditorState, type EditorState } from "@/lib/builder/store";
import { BuilderProvider } from "@/components/builder/context";
import { SettingsPanel } from "@/components/builder/SettingsPanel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function envelope(overrides?: {
  blocks?: DocumentEnvelope["body"]["blocks"];
  rules?: DocumentEnvelope["body"]["logic"]["rules"];
}): DocumentEnvelope {
  return {
    id: "doc1",
    rev: 7,
    title: "Fixture form",
    status: "draft",
    type: "form",
    body: {
      schemaVersion: 1,
      type: "form",
      theme: {
        tokens: { ...DEFAULT_THEME_TOKENS },
        fontHeading: "Inter",
        fontBody: "Inter",
        radius: "md",
      },
      settings: {
        seo: { title: "Fixture SEO title" },
        locale: "en",
        progressBar: true,
        autoAdvance: true,
        showBranding: true,
        captcha: false,
        notifyEmails: ["team@example.com"],
      },
      blocks: overrides?.blocks ?? [
        {
          id: "q1",
          kind: "short-text",
          props: { label: "What is your name?", placeholder: "", required: false },
        },
        { id: "uk1", kind: "future-widget", props: { payload: { n: 1 } } },
      ],
      endings: [{ id: "end1", title: "Thanks!" }],
      logic: { rules: overrides?.rules ?? [] },
    },
  };
}

function seededState(
  env: DocumentEnvelope,
  selection: string | null = null,
  panel: EditorState["panel"] = "document",
): EditorState {
  return {
    ...initialEditorState(env.id),
    ready: true,
    mode: "mock",
    meta: { title: env.title },
    body: env.body,
    docStatus: env.status,
    rev: env.rev,
    selection,
    panel,
  };
}

function Harness({
  env,
  selection = null,
  panel = "document",
  initialTab,
}: {
  env: DocumentEnvelope;
  selection?: string | null;
  panel?: EditorState["panel"];
  initialTab?: "general" | "behavior" | "limits" | "notifications" | "seo";
}) {
  const initial = useMemo(() => seededState(env, selection, panel), [env, selection, panel]);
  return h(BuilderProvider, {
    docId: env.id,
    initialState: initial,
    children: h(SettingsPanel, initialTab ? { initialTab } : {}),
  });
}

// The registry really knows the fixture kind (guards against a silent
// no-registration regression that would fake the Content-section asserts).
it("fixture sanity: short-text is a registered question block", () => {
  const def = getBlockDef("short-text");
  expect(def?.family).toBe("question");
});

const BASE_ENV = envelope();

describe("<SettingsPanel> with a selected block (§6.6 block view)", () => {
  const env = envelope({
    rules: [
      {
        id: "r1",
        scope: "q1",
        when: [{ left: "@block:q1", op: "isEmpty" }],
        then: [{ type: "goto", target: "end:end1" }],
        isFallback: false,
      },
    ],
  });

  it("renders the registry Editor (Content) plus Behavior / Logic / Advanced sections", () => {
    const html = renderToStaticMarkup(h(Harness, { env, selection: "q1", panel: "block" }));
    // Content: the short-text editor markup (§9.2)
    expect(html).toContain("ff-editor--short-text");
    expect(html).toContain('value="What is your name?"');
    // Behavior: generic question fields (§9.1)
    expect(html).toContain("Behavior");
    expect(html).toContain("Required");
    expect(html).toContain("Button text");
    expect(html).toContain("Prefill param");
    // Logic summary: one scoped rule (§6.6 "N rules start here")
    expect(html).toContain("1 rule starts here");
    expect(html).toContain('href="/d/doc1/logic"');
    // Advanced: read-only id + copy + reset
    expect(html).toContain("Advanced");
    expect(html).toContain('value="q1"');
    expect(html).toContain('aria-label="Copy block id"');
    expect(html).toContain("Reset to defaults");
  });

  it("shows the §5.4 note for unknown kinds (settings read-only)", () => {
    const html = renderToStaticMarkup(h(Harness, { env, selection: "uk1", panel: "block" }));
    expect(html).toContain("This block type isn&#x27;t supported in this version");
    expect(html).not.toContain("ff-editor--short-text");
  });

  it("warns (non-blocking) when the label suggests sensitive data (§8.2)", () => {
    const sensitiveEnv = envelope({
      blocks: [
        {
          id: "q1",
          kind: "short-text",
          props: { label: "Your password", placeholder: "", required: false },
        },
      ],
    });
    const html = renderToStaticMarkup(h(Harness, { env: sensitiveEnv, selection: "q1", panel: "block" }));
    expect(html).toContain("sensitive data");
  });

  it("warns when stored props fail the kind schema but keeps the editor editable", () => {
    const brokenEnv = envelope({
      // label: 42 violates z.string().min(1) — safeParse fails, raw props pass through
      blocks: [{ id: "q1", kind: "short-text", props: { label: 42, required: false } as never }],
    });
    const html = renderToStaticMarkup(h(Harness, { env: brokenEnv, selection: "q1", panel: "block" }));
    expect(html).toContain("Some fields could not be parsed");
  });
});

describe("<SettingsPanel> document settings (§6.6 document view)", () => {
  it("renders the five tabs with an aria tablist (defaults to General)", () => {
    const html = renderToStaticMarkup(h(Harness, { env: BASE_ENV }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Document settings"');
    for (const tab of ["General", "Behavior", "Limits", "Notifications", "SEO"]) {
      expect(html).toContain(tab);
    }
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Slug");
    expect(html).toContain("Language");
  });

  it("Behavior tab: toggles + the §24 static branding gate (inline note, no modal)", () => {
    const html = renderToStaticMarkup(h(Harness, { env: BASE_ENV, initialTab: "behavior" }));
    expect(html).toContain("Progress bar");
    expect(html).toContain("Auto-advance");
    expect(html).toContain("Captcha");
    expect(html).toContain("Show FormForge branding");
    expect(html).toContain("Available on Pro");
  });

  it("Limits tab: closeAt + max submissions (both exist in DocumentSettings)", () => {
    const html = renderToStaticMarkup(h(Harness, { env: BASE_ENV, initialTab: "limits" }));
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("Max submissions");
    expect(html).toContain("UTC");
  });

  it("Notifications tab: list editor + disabled test-send (Coming soon)", () => {
    const html = renderToStaticMarkup(h(Harness, { env: BASE_ENV, initialTab: "notifications" }));
    expect(html).toContain("Notify emails (1/10)");
    expect(html).toContain("team@example.com");
    expect(html).toContain("Send test email");
    expect(html).toContain('title="Coming soon"');
    expect(html).toContain("disabled");
  });

  it("SEO tab: fields, disabled OG picker and the live social preview card", () => {
    const html = renderToStaticMarkup(h(Harness, { env: BASE_ENV, initialTab: "seo" }));
    expect(html).toContain("SEO title");
    expect(html).toContain("SEO description");
    expect(html).toContain("Image picker coming soon");
    expect(html).toContain("ff-set-social-preview");
    expect(html).toContain("Fixture SEO title");
    expect(html).toContain("formforge.app");
  });
});
