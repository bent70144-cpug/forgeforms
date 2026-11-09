// Shared settings tab rail (F4) — server-safe, no hooks. One glass segmented
// pill rail rendered by all three settings surfaces (billing / domains /
// tokens); pass `current` with the page's own id to get aria-current plus the
// violet active pill (token-driven tint + soft glow so it reads as "aurora"
// without any animation — reduced-motion safe by construction).
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
      className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1"
      style={{
        background: "var(--ff-glass)",
        boxShadow: "inset 0 0 0 1px var(--ff-glass-border), var(--ff-shadow-sm)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium no-underline transition-colors hover:text-[var(--ff-fg)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)]"
            style={
              active
                ? {
                    color: "var(--ff-fg)",
                    background: "color-mix(in srgb, var(--ff-primary) 20%, transparent)",
                    boxShadow:
                      "inset 0 0 0 1px color-mix(in srgb, var(--ff-primary) 50%, transparent), 0 6px 20px -8px color-mix(in srgb, var(--ff-primary) 60%, transparent)",
                  }
                : { color: "var(--ff-muted)" }
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
