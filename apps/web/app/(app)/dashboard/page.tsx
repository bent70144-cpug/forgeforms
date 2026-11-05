import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  return (
    <AppShell user={session.user} workspace={session.workspace}>
      <DashboardEmptyState />
    </AppShell>
  );
}
