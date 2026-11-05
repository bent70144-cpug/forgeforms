import type { ReactNode } from "react";
import type { UserRecord, WorkspaceRecord } from "@formforge/core/identity";
import { logoutAction } from "@/lib/auth/actions";

// App shell (spec §14.1.2): top bar with workspace + account, content region.
export function AppShell({
  user,
  workspace,
  children,
}: {
  user: UserRecord;
  workspace: WorkspaceRecord | null;
  children: ReactNode;
}) {
  return (
    <div className="ff-app">
      <header className="ff-app-header">
        <span className="ff-logo" aria-hidden="true">
          FormForge
        </span>
        <nav aria-label="Primary">
          <a href="/dashboard" aria-current="page">
            Dashboard
          </a>
        </nav>
        <div className="ff-app-header-meta">
          <span className="ff-chip">{workspace?.name ?? "Your workspace"}</span>
          <span className="ff-subtle">{user.email}</span>
          <form action={logoutAction}>
            <button type="submit" className="ff-button ff-button-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="ff-app-main">{children}</main>
    </div>
  );
}
