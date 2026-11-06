// Standalone AI surface for a document: draft + edit-with-AI workbench
// (spec §15 M8). The builder (T05) will embed the same components in its
// panes; this route keeps the flows reachable and manually testable.
import { AiWorkbench } from "../../../../../components/ai";

export const metadata = {
  title: "AI — FormForge",
};

export default async function DocumentAiPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  return <AiWorkbench docId={docId} />;
}
