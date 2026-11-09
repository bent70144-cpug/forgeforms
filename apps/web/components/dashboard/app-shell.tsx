import type { ReactNode } from "react";
import type { UserRecord, WorkspaceRecord } from "@formforge/core/identity";
import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { BTN_GHOST, BTN_GHOST_SM } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { MobileMenu, NavLinks, type NavItem } from "./nav-links";

// App shell (spec §14.1.2, Meridian redesign): a paper sidebar (wordmark,
// primary nav rows, workspace footer) beside the content column, whose sticky
// topbar carries the ghost account/sign-out controls. No glass blur, no
// gradient chrome — hairlines and quiet surfaces do the structural work.
// Server component — the interactive tail (mobile menu) is delegated to
// <MobileMenu>, which receives the sign-out form as a node so the server
// action stays server-owned.

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/templates", label: "Templates", icon: "layers" },
  { href: "/settings/billing", label: "Settings", icon: "settings" },
];

/** Wordmark: a small ultramarine square mark + the name in Sora 700. */
function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ background: "var(--ff-primary)" }}
      />
      <span
        className="whitespace-nowrap text-[1.0625rem] font-bold tracking-[-0.02em] text-[var(--ff-fg)]"
        style={{ fontFamily: "var(--ff-font-heading)" }}
      >
        FormForge
      </span>
    </span>
  );
}

export function AppShell({
  user,
  workspace,
  children,
}: {
  user: UserRecord;
  workspace: WorkspaceRecord | null;
  children: ReactNode;
}) {
  const workspaceName = workspace?.name ?? "Your workspace";

  return (
    // .ff-app defaults to a column; the shell is a sidebar + content row.
    <div className="ff-app" style={{ flexDirection: "row" }}>
      {/* Sidebar — paper chrome, right hairline (md+ only; mobile uses the
          drawer's nav). The workspace block pins to the floor. */}
      <aside
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto md:flex"
        style={{
          background: "var(--ff-bg)",
          borderRight: "1px solid var(--ff-border)",
        }}
      >
        <div
          className="flex h-16 shrink-0 items-center border-b px-5"
          style={{ borderColor: "var(--ff-border)" }}
        >
          <Link
            href="/dashboard"
            aria-label="FormForge dashboard"
            className="flex no-underline"
          >
            <Wordmark />
          </Link>
        </div>
        <nav aria-label="Primary" className="flex flex-col px-3 py-4">
          <NavLinks items={NAV_ITEMS} orientation="vertical" />
        </nav>
        <div
          className="mt-auto px-5 pb-5 pt-4"
          style={{ borderTop: "1px solid var(--ff-border)" }}
        >
          <p className="m-0 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--ff-muted)]">
            Workspace
          </p>
          <p
            className="m-0 mt-1 truncate text-sm font-medium text-[var(--ff-fg)]"
            title={workspaceName}
          >
            {workspaceName}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar — solid --ff-glass white chrome with a bottom hairline. The
            unlayered .ff-app-header recipe still ships a backdrop blur; the
            inline overrides pin it to the flat Meridian surface. */}
        <header
          className="ff-app-header sticky top-0 z-40"
          style={{
            padding: 0,
            background: "var(--ff-glass)",
            WebkitBackdropFilter: "none",
            backdropFilter: "none",
            borderBottom: "1px solid var(--ff-border)",
          }}
        >
          <div className="mx-auto flex h-16 w-full max-w-[72rem] items-center gap-4 px-[clamp(1rem,3vw,1.5rem)]">
            {/* mobile wordmark — the desktop one lives in the sidebar */}
            <Link
              href="/dashboard"
              aria-label="FormForge dashboard"
              className="flex shrink-0 no-underline md:hidden"
            >
              <Wordmark />
            </Link>

            <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-2.5">
              {/* account chip — quiet hairline pill with a tinted initial */}
              <span
                className="hidden min-w-0 items-center gap-2 lg:flex"
                title={user.email}
                style={{
                  background: "var(--ff-card)",
                  border: "1px solid var(--ff-border)",
                  borderRadius: "999px",
                  padding: "0.1875rem 0.75rem 0.1875rem 0.25rem",
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold"
                  style={{
                    background:
                      "color-mix(in srgb, var(--ff-primary) 10%, var(--ff-card))",
                    color: "var(--ff-primary)",
                  }}
                >
                  {user.email.charAt(0).toUpperCase()}
                </span>
                <span className="max-w-[14rem] truncate text-[0.8125rem] text-[var(--ff-muted)]">
                  {user.email}
                </span>
              </span>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className={BTN_GHOST_SM}
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <Icon name="logout" size={15} />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </form>
              <MobileMenu
                items={NAV_ITEMS}
                workspaceName={workspaceName}
                userEmail={user.email}
                signOut={
                  <form action={logoutAction}>
                    <button type="submit" className={`${BTN_GHOST} w-full`}>
                      <Icon name="logout" size={16} />
                      Sign out
                    </button>
                  </form>
                }
              />
            </div>
          </div>
        </header>
        <main
          className="ff-app-main"
          style={{ maxWidth: "72rem", padding: "2rem clamp(1rem, 3vw, 1.5rem)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
