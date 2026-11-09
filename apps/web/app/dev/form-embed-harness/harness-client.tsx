"use client";

// T21 — interactive part of the form-embed postMessage harness:
//   1. Parent listener — logs every ff:* message arriving on this window and
//      whether its source matches the child frame (guard + filter demo).
//   2. Block under test — mounts FormEmbedRender (@formforge/blocks), which
//      listens to its own child frame, resizes on ff:height, and forwards
//      ff:height/ff:complete upward (a no-op at top level; exercised live when
//      this page is itself embedded, unit-tested via postToEmbedParent).
//   3. Simulate — dispatches synthetic MessageEvents with the child frame as
//      source: one valid height, one valid complete, one junk payload (must be
//      ignored by the guards).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  FormEmbedRender,
  formEmbedDefaultProps,
  isCompleteMessage,
  isHeightMessage,
} from "@formforge/blocks";

import { Icon } from "@/components/ui/icons";
import { BTN_PRIMARY_SM, BTN_SECONDARY_SM } from "@/lib/ui";

type LogEntry = { at: string; kind: "height" | "complete" | "junk"; detail: string };

function Chip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-1 font-mono text-[13px] text-[var(--ff-fg)]">
      {children}
    </code>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  // Dev-lab section header: mono uppercase label separated by a hairline rule.
  return (
    <h2 className="mt-10 border-t border-[var(--ff-border)] pt-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-[var(--ff-muted)]">
      {children}
    </h2>
  );
}

export default function HarnessClient({ docId }: { docId: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const push = useCallback((entry: Omit<LogEntry, "at">) => {
    setLog((prev) => [{ ...entry, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 25));
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const fromChild = event.source === frameRef.current?.contentWindow;
      if (isHeightMessage(event.data)) {
        push({ kind: "height", detail: `value=${event.data.value} fromChild=${String(fromChild)}` });
      } else if (isCompleteMessage(event.data)) {
        push({ kind: "complete", detail: `submissionToken=${event.data.submissionToken} fromChild=${String(fromChild)}` });
      } else {
        const raw = typeof event.data === "string" ? event.data : JSON.stringify(event.data) ?? "non-serializable";
        push({ kind: "junk", detail: `ignored: ${raw.slice(0, 80)}` });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [push]);

  const simulate = useCallback(
    (data: unknown) => {
      window.dispatchEvent(new MessageEvent("message", { source: frameRef.current?.contentWindow ?? null, data }));
    },
    [],
  );

  return (
    <div className="mt-6">
      <SectionTitle>1 · Block under test (form-embed)</SectionTitle>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
        The frame below is rendered by <Chip>FormEmbedRender</Chip>; it resizes itself when the child
        posts <Chip>ff:height</Chip>.
      </p>
      <div className="mt-3 overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4 shadow-[var(--ff-shadow-md)]">
        <FormEmbedRender props={{ ...formEmbedDefaultProps(), documentId: docId }} />
      </div>

      <SectionTitle>2 · Reference child frame (parent listens)</SectionTitle>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
        A bare frame the harness listens to directly — real <Chip>ff:ready</Chip>/<Chip>ff:height</Chip>{" "}
        messages arrive from the embed shell (only height/complete pass the harness guards).
      </p>
      <div className="mt-3 overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4 shadow-[var(--ff-shadow-md)]">
        <iframe
          ref={frameRef}
          src={`/embed/${docId}`}
          title="Harness child frame"
          className="h-48 w-full rounded-lg border border-[var(--ff-border)]"
        />
      </div>

      <SectionTitle>3 · Simulate child messages</SectionTitle>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className={BTN_SECONDARY_SM}
          onClick={() => simulate({ type: "ff:height", value: 512 })}
        >
          Post ff:height 512
        </button>
        <button
          type="button"
          className={BTN_PRIMARY_SM}
          onClick={() => simulate({ type: "ff:complete", submissionToken: "sub_harness_token" })}
        >
          Post ff:complete
        </button>
        <button
          type="button"
          className={BTN_SECONDARY_SM}
          onClick={() => simulate({ type: "ff:height", value: "not-a-number" })}
        >
          Post junk (must be ignored)
        </button>
      </div>

      <SectionTitle>Event log</SectionTitle>
      {/* Ink telemetry well — the sanctioned ink-well treatment (var(--ff-fg)
          as bg, paper-mixed text) so it flips coherently in night mode. */}
      <div
        className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-[var(--ff-radius)] border p-3 font-mono text-xs leading-relaxed"
        style={{
          background: "var(--ff-fg)",
          color: "color-mix(in srgb, var(--ff-bg) 92%, var(--ff-fg))",
          borderColor: "color-mix(in srgb, var(--ff-bg) 16%, transparent)",
        }}
      >
        {log.length === 0 ? (
          <p style={{ color: "color-mix(in srgb, var(--ff-bg) 58%, var(--ff-fg))" }}>Waiting for messages…</p>
        ) : null}
        {log.map((entry, index) => (
          <p key={`${entry.at}-${index}`} className="break-words">
            <span style={{ color: "color-mix(in srgb, var(--ff-bg) 58%, var(--ff-fg))" }}>[{entry.at}]</span>{" "}
            <Icon
              name={entry.kind === "junk" ? "x" : "check"}
              size={12}
              className="inline-block align-[-1px]"
              style={{
                color:
                  entry.kind === "junk"
                    ? "color-mix(in srgb, var(--ff-danger) 72%, var(--ff-bg))"
                    : "color-mix(in srgb, var(--ff-success) 72%, var(--ff-bg))",
              }}
            />{" "}
            <strong>{entry.kind}</strong> {entry.detail}
          </p>
        ))}
      </div>
    </div>
  );
}
