"use client";

// Copy-to-clipboard code block for the /embed docs page.
// Client component (bundled by Next — safe under the strict-nonce CSP on
// /embed/*: no inline <script>). The <pre> is a fixed ink block so code reads
// as "printed" in both themes.
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icons";
import { ICON_BTN } from "@/lib/ui";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — copy is a
      // progressive enhancement; the code stays selectable either way.
    }
  }

  return (
    <div className="group relative mt-3 overflow-hidden rounded-[12px] border border-[var(--ff-border)]">
      <div
        className="flex items-center justify-between gap-2 border-b border-[var(--ff-border)] px-3 py-1.5"
        style={{ background: "color-mix(in srgb, var(--ff-fg) 4%, var(--ff-bg))" }}
      >
        <span className="font-mono text-xs text-[var(--ff-muted)]">{label ?? "code"}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className={ICON_BTN}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
        </button>
      </div>
      <pre className="overflow-x-auto bg-[#211d18] p-4 font-mono text-[13px] leading-relaxed text-[#f4eee5]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
