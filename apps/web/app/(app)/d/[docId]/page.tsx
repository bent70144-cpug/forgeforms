// Builder route (spec §4): `/d/:docId`. Server shell only — the client
// BuilderPage owns the editor store, the autosave loop and the three-pane
// layout (same split as the sibling logic route).
import type { Metadata } from "next";
import { BuilderPage } from "@/components/builder/BuilderPage";

export const metadata: Metadata = {
  title: "Builder — FormForge",
};

export default async function BuilderRoute({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  return <BuilderPage docId={docId} />;
}
