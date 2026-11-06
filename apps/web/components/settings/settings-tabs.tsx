// Shared settings tab bar (F4) — server-safe, no hooks. One underline-tab
// strip rendered by all three settings surfaces (billing / domains / tokens);
// pass `current` with the page's own id to get aria-current + the 2px coral
// underline (inset box-shadow so it sits on the container hairline).
//
// Usage:
//   <SettingsTabs current="billing" />

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icons";

export type SettingsTabId = "billing" | "domains" | "tokens";

const TABS: ReadonlyArray<{
  id: SettingsTabId;
  href: string;
  label: string;
  icon: IconName;
}> = [
  { id: "billing", href: "/settings/billing", label: "Billing", icon: "creditCard" },
  { id: "domains", href: "/settings/domains", label: "Custom domains", icon: "globe" },
  { id: "tokens", href: "/settings/tokens", label: "API tokens", icon: "key" },
];

export function SettingsTabs({ current }: { current: SettingsTabId }) {
  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 flex gap-6 overflow-x-auto border-b border-[var(--ff-border)]"
    >
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-2.5 pt-1 text-[0.875rem] no-underline transition-colors hover:text-[var(--ff-fg)] ${
              active ? "" : "text-[var(--ff-muted)]"
            }`}
            style={
              active
                ? {
                    color: "var(--ff-fg)",
                    fontWeight: 550,
                    boxShadow: "inset 0 -2px 0 0 var(--ff-accent)",
                  }
                : undefined
            }
          >
            <Icon name={tab.icon} size={14} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
