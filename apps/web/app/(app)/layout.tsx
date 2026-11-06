import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { getCurrentSession } from "@/lib/auth/session";

// Every authenticated surface (dashboard, document sub-pages, settings) shares
// one shell: session is resolved once here so pages stay lean.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  return (
    <AppShell user={session.user} workspace={session.workspace}>
      {children}
    </AppShell>
  );
}
