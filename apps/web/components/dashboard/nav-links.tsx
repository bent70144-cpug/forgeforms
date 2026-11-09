"use client";

// App-shell navigation (F4, Meridian redesign): editorial nav rows + the
// mobile menu.
//
// · NavLinks — the primary nav rendered as quiet paper rows. The active route
//   (usePathname) gets aria-current="page", an ultramarine 10% tint
//   background, ultramarine text and — on vertical rows — a 2px left
//   ultramarine indicator; inactive rows keep ink text with muted icons and
//   hover to the recessed --ff-bg-2 wash. (The old inline-style custom-
//   property dance existed to beat the unlayered `.ff-app-header nav a` rules;
//   both nav regions now render outside the header, so plain layered
//   utilities are enough.) Keyboard focus comes from the global
//   `a:focus-visible` rule in globals.css (2px accent outline).
// · MobileMenu — the <md menu button + Drawer sheet (right, 18rem) with the
//   same links, workspace name and a sign-out form. The Drawer primitive owns
//   Esc / backdrop / focus handling; this component only closes on route
//   change so tapping a link dismisses the sheet.
//   (`md:hidden!` carries an important modifier: .ff-icon-btn is unlayered CSS
//   and would otherwise beat the layered md:hidden utility, leaving the
//   hamburger visible on desktop.)

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { Drawer } from "@/components/ui/drawer";
import { ICON_BTN } from "@/lib/ui";

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

// Shared row base. :focus-visible styling comes from the unlayered global
// `a:focus-visible` rule in globals.css (2px accent outline), which beats any
// layered utility — so no Tailwind focus classes are needed here.
const NAV_ROW =
  "relative inline-flex select-none items-center no-underline transition-colors";

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
              NAV_ROW,
              vertical
                ? "min-h-[2.75rem] w-full gap-2.5 rounded-[10px] px-3 text-[0.9375rem]" // 44px touch row
                : "h-9 gap-2 rounded-lg px-3 text-[0.875rem]",
              // Inactive rows hover to the recessed paper wash; the active
              // row deepens its ultramarine tint instead. One hover rule per
              // state — no cascade fights between the two.
              active
                ? "bg-[color-mix(in_srgb,var(--ff-primary)_10%,transparent)] font-semibold text-[var(--ff-primary)] hover:bg-[color-mix(in_srgb,var(--ff-primary)_14%,transparent)]"
                : "font-medium text-[var(--ff-fg)] hover:bg-[var(--ff-bg-2)]",
            ].join(" ")}
            style={
              // 2px left ultramarine indicator — vertical (sidebar/drawer)
              // rows only; the horizontal variant reads better without it.
              vertical && active
                ? { boxShadow: "inset 2px 0 0 0 var(--ff-primary)" }
                : undefined
            }
          >
            {item.icon ? (
              <span
                aria-hidden="true"
                className={
                  active
                    ? "inline-flex text-[var(--ff-primary)]"
                    : "inline-flex text-[var(--ff-muted)]"
                }
              >
                <Icon name={item.icon} size={vertical ? 17 : 15} />
              </span>
            ) : null}
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
        <div className="flex flex-col">
          {/* workspace block — hairline rule separates it from the nav */}
          <div className="pb-4" style={{ borderBottom: "1px solid var(--ff-border)" }}>
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
          <nav aria-label="Primary" className="flex flex-col pt-3">
            <NavLinks items={items} orientation="vertical" />
          </nav>
        </div>
      </Drawer>
    </>
  );
}
