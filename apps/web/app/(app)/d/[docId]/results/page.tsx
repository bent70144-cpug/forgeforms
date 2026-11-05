// T15 — Results screen route (spec §14.1.5): `/d/:docId/results`.
// Server shell only — data loads through the ResultsClient seam so this works
// against fixtures (mock) today and the live API (T14) tomorrow.

import type { Metadata } from "next";
import { ResultsScreen } from "../../../../../components/results/ResultsScreen";

export const metadata: Metadata = {
  title: "Results — FormForge",
};

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  return <ResultsScreen docId={docId} />;
}
