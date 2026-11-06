import type { ReactNode } from "react";
import type { UserRecord, WorkspaceRecord } from "@formforge/core/identity";
import { logoutAction } from "@/lib/auth/actions";

// App shell (spec §14.1.2): sticky top bar with workspace + account, content region.
// The translucent card background uses color-mix on the design token so it adapts
// to light/dark automatically; the bar wraps (instead of overflowing) on narrow
// screens.
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
      <header
        className="ff-app-header sticky top-0 z-40 flex-wrap backdrop-blur"
        style={{
          backgroundColor: "color-mix(in srgb, var(--ff-card) 88%, transparent)",
          rowGap: "0.5rem",
        }}
      >
        <a href="/dashboard" aria-label="FormForge dashboard" className="ff-logo">
          FormForge
        </a>
        <nav aria-label="Primary" className="flex items-center gap-4">
          <a
            href="/dashboard"
            aria-current="page"
            style={{ color: "var(--ff-primary)", fontWeight: 600 }}
          >
            Dashboard
          </a>
          <a href="/templates" target="_blank" rel="noreferrer">
            Templates
          </a>
        </nav>
        <div className="ff-app-header-meta">
          <span className="ff-chip inline-block max-w-[10rem] truncate align-middle">
            {workspace?.name ?? "Your workspace"}
          </span>
          <span className="ff-subtle hidden sm:inline">{user.email}</span>
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
