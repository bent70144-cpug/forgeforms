import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { DocumentsView } from "@/components/dashboard/documents-view";
import { getCurrentSession } from "@/lib/auth/session";
import { listTemplates } from "@formforge/core/templates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

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

  return (
    <AppShell user={session.user} workspace={session.workspace}>
      <DocumentsView templates={templates} />
    </AppShell>
  );
}
