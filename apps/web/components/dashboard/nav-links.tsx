"use client";

// App-shell navigation (F4, aurora redesign): pill nav + the mobile menu.
//
// · NavLinks — the primary nav rendered as pills. The active route
//   (usePathname) gets aria-current="page", a violet-tinted pill
//   (color-mix with --ff-primary) plus a soft violet glow; inactive pills
//   hover to a cyan tint (and the active pill deepens its violet). Colors
//   resolve through two local custom properties (--ff-nav-fg / --ff-nav-bg)
//   that inline styles consume: globals.css ships unlayered
//   `.ff-app-header nav a` rules that would beat layered Tailwind utilities,
//   and inline styles win there; hover variants flip the custom properties,
//   so hover works despite the inline color/background. No bar/underline
//   indicator anymore — the pill IS the active indicator.
// · MobileMenu — the <md menu button + Drawer sheet (right, 18rem) with the
//   same links, workspace name, user email and a sign-out form. The Drawer
//   primitive owns Esc / backdrop / focus handling; this component only closes
//   on route change so tapping a link dismisses the sheet.
//   (`md:hidden!` carries an important modifier: .ff-icon-btn is unlayered CSS
//   and would otherwise beat the layered md:hidden utility, leaving the
//   hamburger visible on desktop.)

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { Drawer } from "@/components/ui/drawer";
import { ICON_BTN } from "@/lib/ui";

const EASE = "var(--ff-ease-out)";

export type NavItem = {
  href: string;
  label: string;
  icon?: IconName;
};

/** First path segment ("/settings/billing" → "settings"). */
function firstSegment(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Dashboard matches exactly (it is a leaf); everything else matches by prefix.
 * Deep links that share a first segment with the pathname light up too, so the
 * "Settings" entry (/settings/billing) stays active on /settings/domains and
 * /settings/tokens.
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (pathname.startsWith(`${href}/`)) return true;
  const hrefSegments = href.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (hrefSegments.length < 2 || pathSegments.length < 2) return false;
  return firstSegment(href) === firstSegment(pathname);
}

// Shared pill base. :focus-visible styling comes from the unlayered global
// `a:focus-visible` rule in globals.css (2px accent outline), which beats any
// layered utility — so no Tailwind focus classes are needed here.
const PILL =
  "relative inline-flex select-none items-center rounded-full no-underline";

export function NavLinks({
  items,
  orientation = "horizontal",
}: {
  items: NavItem[];
  orientation?: "horizontal" | "vertical";
}) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";

  return (
    <div className={vertical ? "flex flex-col gap-1" : "flex items-center gap-1"}>
      {items.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              PILL,
              vertical
                ? "min-h-[2.75rem] w-full gap-2.5 px-3.5 text-[0.9375rem]" // 44px touch row
                : "h-8 gap-1.5 px-3 text-[0.875rem]",
              // Inactive pills hover to a cyan tint; the active pill deepens
              // its violet instead. One hover rule per state — no cascade
              // fights between the two.
              active
                ? "[--ff-nav-bg:color-mix(in_srgb,var(--ff-primary)_16%,transparent)] hover:[--ff-nav-bg:color-mix(in_srgb,var(--ff-primary)_24%,transparent)]"
                : "hover:[--ff-nav-fg:color-mix(in_srgb,var(--ff-accent)_40%,var(--ff-fg))] hover:[--ff-nav-bg:color-mix(in_srgb,var(--ff-accent)_8%,transparent)]",
            ].join(" ")}
            style={{
              // Inline styles beat the unlayered `.ff-app-header nav a` rules;
              // the hover variants above flip the custom properties they read.
              color: `var(--ff-nav-fg, ${active ? "var(--ff-fg)" : "var(--ff-muted)"})`,
              background: "var(--ff-nav-bg, transparent)",
              fontWeight: active ? 600 : 500,
              boxShadow: active
                ? "inset 0 0 0 1px color-mix(in srgb, var(--ff-primary) 30%, transparent), 0 2px 14px -4px color-mix(in srgb, var(--ff-primary) 42%, transparent)"
                : "none",
              transition: `color 150ms ${EASE}, background-color 150ms ${EASE}, box-shadow 150ms ${EASE}`,
            }}
          >
            {item.icon ? <Icon name={item.icon} size={vertical ? 17 : 15} /> : null}
            <span className={vertical ? "flex-1" : undefined}>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Client wrapper for the app header's interactive tail: the <md menu button
 * and its Drawer sheet. `signOut` is a server-rendered <form action={logoutAction}>
 * passed through from the server shell — no action is imported here.
 */
export function MobileMenu({
  items,
  workspaceName,
  userEmail,
  signOut,
}: {
  items: NavItem[];
  workspaceName: string;
  userEmail: string;
  signOut: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Any navigation (link tap inside the sheet) dismisses it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        className={`${ICON_BTN} md:hidden!`}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size={18} />
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Menu"
        description={userEmail}
        side="right"
        width="18rem"
        footer={signOut}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--ff-muted)]">
              Workspace
            </span>
            <span className="ff-chip max-w-full truncate" title={workspaceName}>
              {workspaceName}
            </span>
          </div>
          <nav aria-label="Primary" className="flex flex-col">
            <NavLinks items={items} orientation="vertical" />
          </nav>
        </div>
      </Drawer>
    </>
  );
}
