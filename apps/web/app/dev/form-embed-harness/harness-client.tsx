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

import {
  FormEmbedRender,
  formEmbedDefaultProps,
  isCompleteMessage,
  isHeightMessage,
} from "@formforge/blocks";

type LogEntry = { at: string; kind: "height" | "complete" | "junk"; detail: string };

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
      <h2 className="text-lg font-semibold text-slate-900">1 · Block under test (form-embed)</h2>
      <p className="mt-1 text-sm">
        The frame below is rendered by <code>FormEmbedRender</code>; it resizes itself when the child
        posts <code>ff:height</code>.
      </p>
      <div className="mt-3 rounded-xl border border-slate-200 p-4">
        <FormEmbedRender props={{ ...formEmbedDefaultProps(), documentId: docId }} />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">2 · Reference child frame (parent listens)</h2>
      <p className="mt-1 text-sm">
        A bare frame the harness listens to directly — real <code>ff:ready</code>/<code>ff:height</code>{" "}
        messages arrive from the embed shell (only height/complete pass the harness guards).
      </p>
      <div className="mt-3 rounded-xl border border-slate-200 p-4">
        <iframe ref={frameRef} src={`/embed/${docId}`} title="Harness child frame" className="h-48 w-full rounded-lg border border-slate-300" />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">3 · Simulate child messages</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          onClick={() => simulate({ type: "ff:height", value: 512 })}
        >
          Post ff:height 512
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          onClick={() => simulate({ type: "ff:complete", submissionToken: "sub_harness_token" })}
        >
          Post ff:complete
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          onClick={() => simulate({ type: "ff:height", value: "not-a-number" })}
        >
          Post junk (must be ignored)
        </button>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Event log</h2>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
        {log.length === 0 ? <p className="text-slate-400">Waiting for messages…</p> : null}
        {log.map((entry, index) => (
          <p key={`${entry.at}-${index}`}>
            [{entry.at}] {entry.kind === "junk" ? "✗" : "✓"} <strong>{entry.kind}</strong> {entry.detail}
          </p>
        ))}
      </div>
    </div>
  );
}
