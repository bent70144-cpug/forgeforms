"use client";

// App-shell navigation (F4): real active states + the mobile menu.
//
// · NavLinks — the primary nav list. Active link (usePathname) gets
//   aria-current="page", fg color, weight 600 and a 2px coral bar that
//   animates in (transform/opacity only, 180ms). Color is set inline on
//   purpose: globals.css ships unlayered `.ff-app-header nav a` rules that
//   would beat Tailwind utilities, and inline styles win there; hover is
//   restored by flipping a local custom property (--ff-nav-fg) via a hover
//   variant, which the inline color resolves.
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
    <div className={vertical ? "flex flex-col gap-0.5" : "flex items-center gap-1"}>
      {items.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "relative inline-flex select-none items-center rounded-md no-underline",
              vertical
                ? "min-h-[2.75rem] w-full gap-2.5 px-3 text-[0.9375rem]" // 44px touch row
                : "h-9 gap-1.5 px-2.5 text-[0.875rem]",
              "hover:bg-[color-mix(in_srgb,var(--ff-fg)_5%,transparent)]",
              active ? "" : "hover:[--ff-nav-fg:var(--ff-fg)]",
            ].join(" ")}
            style={{
              color: active ? "var(--ff-fg)" : "var(--ff-nav-fg, var(--ff-muted))",
              fontWeight: active ? 600 : 500,
              transition: `color 150ms ${EASE}, background-color 150ms ${EASE}`,
            }}
          >
            {item.icon ? <Icon name={item.icon} size={vertical ? 17 : 15} /> : null}
            <span className={vertical ? "flex-1" : undefined}>{item.label}</span>
            <span
              aria-hidden="true"
              className={
                vertical
                  ? "pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-full bg-[var(--ff-accent)]"
                  : "pointer-events-none absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-[var(--ff-accent)]"
              }
              style={{
                transform: active
                  ? vertical
                    ? "scaleY(1)"
                    : "scaleX(1)"
                  : vertical
                    ? "scaleY(0)"
                    : "scaleX(0)",
                opacity: active ? 1 : 0,
                transformOrigin: "center",
                transition: `transform 180ms ${EASE}, opacity 180ms ${EASE}`,
              }}
            />
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
