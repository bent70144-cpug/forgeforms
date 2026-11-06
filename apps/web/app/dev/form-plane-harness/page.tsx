import type { Metadata } from "next";
import { ConversationalFormHarness } from "./harness-client";

/**
 * T28 (issue #28) — conversational-renderer harness: the axe/Lighthouse stand-in
 * for the "public form" surface (spec §16 a11y row + §15 M3 perf budgets).
 *
 * KNOWN GAP (ticket T28 report): the public scroll plane 404s for form documents
 * (apps/web/app/p/[slug]/page.tsx) — the conversational plane route for forms is
 * not landed yet. axe + Lighthouse therefore run against THIS page, which mounts
 * the real ConversationalRenderer with a static published-style document and the
 * mock ingest client (zero network). CI configs the "public form" surface here
 * until the /p form plane exists.
 */
export const metadata: Metadata = {
  title: "Conversational form harness — FormForge",
  description: "A11y/perf harness for the conversational form renderer (T28).",
  robots: { index: false, follow: false },
};

export default function FormPlaneHarnessPage() {
  return <ConversationalFormHarness />;
}
