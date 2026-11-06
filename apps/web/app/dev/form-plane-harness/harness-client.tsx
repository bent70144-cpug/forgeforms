"use client";

// T28 (issue #28) — client half of the form-plane harness (see ./page.tsx).
// Mounts the real @formforge/renderer conversational bundle against a static
// published-style DocumentBody + the mock ingest client (no network), the way
// the /p form plane will host it once that route lands.
//
// Chrome is deliberately minimal: a token-paper canvas with a single muted
// "Harness" badge so screenshots stay unambiguous — the renderer mount itself
// is untouched.
import type { ComponentProps } from "react";
import { ConversationalRenderer, createMockIngestClient } from "@formforge/renderer/conversational";

import { BADGE_MUTED } from "@/lib/ui";

type HarnessDocument = ComponentProps<typeof ConversationalRenderer>["document"];

const SAMPLE_FORM: HarnessDocument = {
  schemaVersion: 1,
  type: "form",
  title: "Product feedback",
  theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
  welcome: {
    enabled: true,
    title: "Tell us what you think",
    body: "Three quick questions — under a minute.",
    buttonText: "Start",
  },
  settings: { progressBar: true, autoAdvance: true, showBranding: true, captcha: false },
  blocks: [
    {
      id: "q1",
      kind: "short-text",
      props: { label: "What is your name?", description: "So we know who to thank.", required: true, placeholder: "Ada Lovelace" },
    },
    {
      id: "q2",
      kind: "email",
      props: { label: "Where should we reply?", required: true, placeholder: "you@example.com" },
    },
    {
      id: "q3",
      kind: "single-select",
      props: {
        label: "Which surface did you try?",
        required: true,
        options: [
          { id: "o1", label: "The form builder" },
          { id: "o2", label: "A published form" },
          { id: "o3", label: "A portfolio page" },
        ],
      },
    },
    {
      id: "q4",
      kind: "long-text",
      props: { label: "Anything else?", description: "Optional — feature requests welcome.", required: false },
    },
  ],
  endings: [{ id: "end_1", title: "Thanks for the feedback!", body: "Our team reads every response." }],
};

export function ConversationalFormHarness() {
  const ingest = createMockIngestClient({ token: "tok_harness", endingId: "end_1" });
  return (
    <main className="min-h-screen bg-[var(--ff-bg)] p-4 sm:p-6">
      <div className="mb-4">
        <span className={BADGE_MUTED}>Harness</span>
      </div>
      <ConversationalRenderer documentId="doc_harness" document={SAMPLE_FORM} ingest={ingest} />
    </main>
  );
}
