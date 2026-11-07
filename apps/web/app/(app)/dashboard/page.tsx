import type { Metadata } from "next";
import { DocumentsView } from "@/components/dashboard/documents-view";
import { listTemplates } from "@formforge/core/templates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ?template=<slug> handoff from the template detail CTA ("Use template"):
  // forwarded into the create modal, which opens straight on the Template tab
  // with that slug selected (Next 15: searchParams is a Promise).
  const sp = await searchParams;
  const prefillTemplate = typeof sp.template === "string" ? sp.template : undefined;

  // The (app) layout resolves the session and renders the app shell;
  // this page only supplies the document list and template catalog.

  // Template catalog for the §11/§14.1.2 create modal ("Blank | Template |
  // Generate with AI"). listTemplates() is a pure in-memory registry read —
  // no I/O. Extra catalog fields (description, counts, logic flag, gradient)
  // feed the in-modal gallery rows; the original {id,name,category} contract
  // stays intact (extra optional fields only).
  const templates = listTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    tags: t.tags,
    blockCount: t.blockCount,
    questionCount: t.questionCount,
    hasLogic: t.hasLogic,
    gradient: t.gradient,
  }));

  return <DocumentsView templates={templates} prefillTemplate={prefillTemplate} />;
}
