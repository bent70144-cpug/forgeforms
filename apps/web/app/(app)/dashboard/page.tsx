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

  // Template catalog for the §14.1.2 create modal ("start from template or
  // blank"). listTemplates() is a pure in-memory registry read — no I/O.
  const templates = listTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
  }));

  return (
    <AppShell user={session.user} workspace={session.workspace}>
      <DocumentsView templates={templates} />
    </AppShell>
  );
}
