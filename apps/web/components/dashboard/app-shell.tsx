import type { ReactNode } from "react";
import type { UserRecord, WorkspaceRecord } from "@formforge/core/identity";
import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { BTN_GHOST, BTN_GHOST_SM } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { MobileMenu, NavLinks, type NavItem } from "./nav-links";

// App shell (spec §14.1.2, aurora redesign): sticky glass top bar with a
// gradient logo wordmark, pill nav, glass workspace/account chips and a ghost
// sign-out with label, over the content region. Server component — the
// interactive tail (mobile menu) is delegated to <MobileMenu>, which receives
// the sign-out form as a node so the server action stays server-owned.

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/templates", label: "Templates", icon: "layers" },
  { href: "/settings/billing", label: "Settings", icon: "settings" },
];

function Wordmark() {
  return (
    <span
      className="whitespace-nowrap text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]"
      style={{ fontFamily: "var(--ff-font-heading)" }}
    >
      Form
      <span
        style={{
          background: "var(--ff-grad)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        Forge
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
    <div className="ff-app">
      <header className="ff-app-header sticky top-0 z-40" style={{ padding: 0 }}>
        <div className="mx-auto flex h-[4rem] w-full max-w-[72rem] items-center gap-4 px-[clamp(1rem,3vw,1.5rem)]">
          <Link
            href="/dashboard"
            aria-label="FormForge dashboard"
            className="flex shrink-0 items-center gap-2.5 no-underline"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{
                background: "var(--ff-grad)",
                color: "var(--ff-primary-fg)",
                boxShadow: "var(--ff-glow)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width={15}
                height={15}
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
            <Wordmark />
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
            {/* account chip — glass pill with gradient-ringed avatar */}
            <span
              className="hidden min-w-0 items-center gap-2 lg:flex"
              title={user.email}
              style={{
                background: "color-mix(in srgb, var(--ff-glass) 65%, transparent)",
                border: "1px solid var(--ff-glass-border)",
                borderRadius: "999px",
                padding: "0.1875rem 0.75rem 0.1875rem 0.25rem",
              }}
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold"
                style={{
                  background:
                    "color-mix(in srgb, var(--ff-primary) 24%, var(--ff-card))",
                  boxShadow:
                    "inset 0 0 0 1px color-mix(in srgb, var(--ff-primary) 35%, transparent)",
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
        {/* aurora hairline along the bottom edge of the bar */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--ff-primary) 55%, transparent) 32%, color-mix(in srgb, var(--ff-accent) 45%, transparent) 68%, transparent)",
            opacity: 0.65,
          }}
        />
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
