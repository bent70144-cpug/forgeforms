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

  // Template catalog for the §14.1.2 create modal ("start from template or
  // blank"). listTemplates() is a pure in-memory registry read — no I/O.
  const templates = listTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
  }));

  return <DocumentsView templates={templates} prefillTemplate={prefillTemplate} />;
}
