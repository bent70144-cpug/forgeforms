import type { ReactNode } from "react";
import type { UserRecord, WorkspaceRecord } from "@formforge/core/identity";
import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { BTN_GHOST, ICON_BTN } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { MobileMenu, NavLinks, type NavItem } from "./nav-links";

// App shell (spec §14.1.2): sticky glass top bar with workspace + account,
// content region. Server component — the interactive tail (mobile menu) is
// delegated to <MobileMenu>, which receives the sign-out form as a node so the
// server action stays server-owned.

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/templates", label: "Templates", icon: "layers" },
  { href: "/settings/billing", label: "Settings", icon: "settings" },
];

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
    <div className="ff-app">
      <header
        className="ff-app-header sticky top-0 z-40"
        style={{
          padding: 0,
          backgroundColor: "color-mix(in srgb, var(--ff-card) 85%, transparent)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
          backdropFilter: "blur(12px) saturate(1.4)",
          borderBottom: "1px solid var(--ff-border)",
        }}
      >
        <div className="mx-auto flex h-[3.75rem] w-full max-w-[72rem] items-center gap-4 px-[clamp(1rem,3vw,1.5rem)]">
          <Link
            href="/dashboard"
            aria-label="FormForge dashboard"
            className="flex shrink-0 items-center gap-2 no-underline"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{
                background: "var(--ff-primary)",
                color: "var(--ff-primary-fg)",
                boxShadow: "var(--ff-shadow-sm)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width={14}
                height={14}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
              </svg>
            </span>
            <span className="text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]">
              FormForge
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden md:block">
            <NavLinks items={NAV_ITEMS} />
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2.5 sm:gap-3">
            {/* NOTE: `hidden!`/`md:inline-flex!` need the important modifier —
                .ff-chip is unlayered CSS, which beats layered Tailwind display
                utilities, so the plain `hidden md:inline-flex` combo leaks the
                chip onto phones (it lives in the drawer there). */}
            <span
              className="ff-chip hidden! max-w-[10rem] truncate md:inline-flex!"
              title={workspaceName}
            >
              {workspaceName}
            </span>
            <span className="hidden min-w-0 items-center gap-2 lg:flex" title={user.email}>
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.75rem] font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--ff-accent) 15%, var(--ff-card))",
                  borderColor: "var(--ff-border)",
                  color: "var(--ff-fg)",
                }}
              >
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[14rem] truncate text-[0.8125rem] text-[var(--ff-muted)]">
                {user.email}
              </span>
            </span>
            <form action={logoutAction}>
              <button type="submit" className={ICON_BTN} aria-label="Sign out" title="Sign out">
                <Icon name="logout" size={18} />
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
  );
}
