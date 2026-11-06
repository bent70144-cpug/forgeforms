// T20 — Logic builder route (spec §14.1.4): `/d/:docId/logic`.
// Server shell only; the client component owns the canvas, rule drawer and
// the autosave loop (T08 transport + autosave seams).

import type { Metadata } from "next";
import { LogicBuilder } from "../../../../../components/logic/LogicBuilder";

export const metadata: Metadata = {
  title: "Logic — FormForge",
};

export default async function LogicPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  return <LogicBuilder docId={docId} />;
}
