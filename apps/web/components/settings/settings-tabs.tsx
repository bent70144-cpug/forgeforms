// Shared settings tab rail (F4) — server-safe, no hooks. One hairline
// underline rail rendered by all three settings surfaces (billing / domains /
// tokens); pass `current` with the page's own id to get aria-current plus the
// ink label + 2px ultramarine underline (inactive labels stay muted). Static
// CSS only — no animation, so it is reduced-motion safe by construction.
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
      className="flex w-full max-w-full items-stretch gap-6 overflow-x-auto border-b border-[var(--ff-border)] sm:gap-8"
    >
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-3 text-[0.8125rem] font-medium no-underline transition-colors ${
              active
                ? "text-[var(--ff-fg)]"
                : "text-[var(--ff-muted)] hover:text-[var(--ff-fg)]"
            }`}
          >
            <Icon name={tab.icon} size={14} />
            {tab.label}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-[2px]"
                style={{ background: "var(--ff-primary)" }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
