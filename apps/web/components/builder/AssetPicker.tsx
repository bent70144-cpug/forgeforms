'use client';

// AssetPicker — the §10 Upload/Library modal (builder audit §10 FAIL → this
// component + the GET /api/v1/assets route close it).
//
//   Upload tab:  file select → POST /api/v1/assets/presign → PUT to the
//   presigned storage URL (never proxied) → POST /api/v1/assets/confirm →
//   "scan pending" state (the worker scan is async, §12) → the §10 alt-text
//   prompt when the target prop can store alt (question imageAssetId is a
//   plain string and cannot; gallery ImageAssetRef records can).
//
//   Library tab: GET /api/v1/assets (workspace-scoped, newest first). Rows
//   show their scan state; only servable (clean/skipped — §17
//   scan-before-download) rows are selectable.
//
// The modal chrome (dialog + focus trap + Esc + backdrop close) mirrors
// BlockPicker so the builder keeps one modal posture (§12).
//
// 2026 restyle: Meridian white modal (hairline border, print-like shadow, ink
// scrim), tokenized tabs/fields, semantic scan-state badges (BADGE_*) and
// BTN_* actions. Library items are hairline grid tiles; a servable tile shows
// an ultramarine ring on keyboard focus. Upload/scan flows untouched.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { AssetPickResult } from "@formforge/blocks";
import type { ScanStatus } from "@formforge/schema/api";
import { BTN_PRIMARY, BTN_SECONDARY, BADGE_DANGER, BADGE_MUTED, BADGE_POSITIVE, BADGE_WARNING } from "@/lib/ui";
import {
  listWorkspaceAssets,
  uploadMediaAsset,
  type FetchLike,
  type WorkspaceAsset,
} from "@/lib/assets/client";

/** The media picker targets images; the upload MIME allowlist carries more
 * (pdf/zip/text) but those belong to the file-upload question block, not here. */
const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif";
const IMAGE_ERROR =
  "Only image files (PNG, JPEG, GIF, WebP, AVIF) can be picked here.";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Tab = "upload" | "library";

type UploadState =
  | { phase: "idle" }
  | { phase: "presigning"; fileName: string }
  | { phase: "uploading"; fileName: string }
  | { phase: "confirming"; fileName: string }
  | { phase: "scan-pending"; fileName: string; assetId: string; scanStatus: ScanStatus }
  | { phase: "error"; fileName: string; message: string };

type LibraryState =
  | { status: "loading" }
  | { status: "ready"; items: WorkspaceAsset[] }
  | { status: "error"; message: string };

export type AssetPickerProps = {
  open: boolean;
  onClose: () => void;
  /** Resolved with the picked reference (the §10 contract). */
  onSelect: (result: AssetPickResult) => void;
  /** Target prop can store alt text → the §10 alt prompt shows after pick. */
  supportsAlt?: boolean;
  /** Test seam — defaults to global fetch (never hit the network in tests). */
  fetchImpl?: FetchLike;
};

function fileNameOf(key: string): string {
  const segments = key.split("/");
  return segments[segments.length - 1] || key;
}

function isServable(scanStatus: ScanStatus): boolean {
  return scanStatus === "clean" || scanStatus === "skipped";
}

function scanLabel(scanStatus: ScanStatus): string {
  switch (scanStatus) {
    case "pending":
      return "Scan pending";
    case "infected":
      return "Blocked";
    case "skipped":
      return "Ready";
    case "clean":
      return "Ready";
  }
}

/** Semantic badge for the §17 scan state (severity mirrors IssuesList). */
function scanBadgeClass(scanStatus: ScanStatus): string {
  switch (scanStatus) {
    case "pending":
      return BADGE_WARNING;
    case "infected":
      return BADGE_DANGER;
    default:
      return scanStatus === "clean" || scanStatus === "skipped" ? BADGE_POSITIVE : BADGE_MUTED;
  }
}

const UPLOAD_PHASE_LABEL: Record<Exclude<UploadState["phase"], "idle" | "error">, string> = {
  presigning: "Requesting a secure upload URL…",
  uploading: "Uploading…",
  confirming: "Verifying upload…",
  "scan-pending": "Upload complete — malware scan pending. The image is usable once the scan completes.",
};

export function AssetPicker({
  open,
  onClose,
  onSelect,
  supportsAlt = false,
  fetchImpl,
}: AssetPickerProps) {
  const doFetch = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const [tab, setTab] = useState<Tab>("upload");
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [library, setLibrary] = useState<LibraryState>({ status: "loading" });
  /** §10 alt step: set after a successful upload/pick when the target prop
   * supports alt; resolves the modal on save/skip. */
  const [altDraft, setAltDraft] = useState<{ assetId: string; value: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listId = useId();

  // On open: reset state, capture focus to restore later, focus the dialog.
  // Kick the Library list fetch (§4 envelope → { data, nextCursor }).
  useEffect(() => {
    if (!open) return;
    setTab("upload");
    setUpload({ phase: "idle" });
    setAltDraft(null);
    previousFocusRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const raf = requestAnimationFrame(() => dialogRef.current?.focus());
    let alive = true;
    setLibrary({ status: "loading" });
    listWorkspaceAssets({ purpose: "media", limit: 50 }, doFetch)
      .then((items) => {
        if (alive) setLibrary({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (alive) {
          setLibrary({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load the asset library",
          });
        }
      });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === "function") previous.focus();
    };
    // doFetch is stable per mount (a prop or a plain wrapper); the modal only
    // reloads when it re-opens.
  }, [open]);

  const handleFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setUpload({ phase: "error", fileName: file.name, message: IMAGE_ERROR });
        return;
      }
      setUpload({ phase: "presigning", fileName: file.name });
      uploadMediaAsset(
        { name: file.name, type: file.type, size: file.size, body: file },
        (phase) => {
          setUpload((current) =>
            current.phase === "idle" || current.phase === "error" || current.phase === "scan-pending"
              ? current
              : { phase, fileName: current.fileName },
          );
        },
        doFetch,
      )
        .then((confirmed) => {
          setUpload({
            phase: "scan-pending",
            fileName: file.name,
            assetId: confirmed.assetId,
            scanStatus: confirmed.scanStatus,
          });
          if (supportsAlt) setAltDraft({ assetId: confirmed.assetId, value: "" });
        })
        .catch((error: unknown) => {
          setUpload({
            phase: "error",
            fileName: file.name,
            message: error instanceof Error ? error.message : "Upload failed",
          });
        });
    },
    [doFetch, supportsAlt],
  );

  const pickLibraryItem = useCallback(
    (item: WorkspaceAsset) => {
      if (!isServable(item.asset.scanStatus as ScanStatus)) return;
      if (supportsAlt) setAltDraft({ assetId: item.asset.id, value: "" });
      else onSelect({ assetId: item.asset.id });
    },
    [onSelect, supportsAlt],
  );

  const resolveAlt = useCallback(
    (withAlt: boolean) => {
      if (!altDraft) return;
      const alt = withAlt && altDraft.value.trim() !== "" ? altDraft.value.trim() : undefined;
      onSelect(alt ? { assetId: altDraft.assetId, alt } : { assetId: altDraft.assetId });
    },
    [altDraft, onSelect],
  );

  const trapFocus = useCallback((event: ReactKeyboardEvent) => {
    const root = dialogRef.current;
    if (!root || typeof document === "undefined") return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    const current = document.activeElement;
    const outside = !(current instanceof Node) || !root.contains(current);
    if (event.shiftKey) {
      if (current === first || outside) {
        event.preventDefault();
        last.focus();
      }
    } else if (current === last || outside) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") trapFocus(event);
    },
    [onClose, trapFocus],
  );

  if (!open) return null;

  const uploadStatusLabel =
    upload.phase === "idle"
      ? null
      : upload.phase === "error"
        ? null
        : upload.phase === "scan-pending"
          ? UPLOAD_PHASE_LABEL["scan-pending"]
          : UPLOAD_PHASE_LABEL[upload.phase];

  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0"
        style={{ background: "rgb(26 29 38 / 0.4)" }}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose an image"
        tabIndex={-1}
        data-testid="ff-asset-picker"
        className="relative mx-auto mt-[10vh] flex w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-[color:var(--ff-border)] bg-[color:var(--ff-card)] text-[color:var(--ff-fg)] shadow-[var(--ff-shadow-lg)] outline-none"
      >
        {/* Tabs */}
        <div role="tablist" aria-label="Asset source" className="flex border-b border-[color:var(--ff-border)]">
          {(
            [
              { id: "upload" as Tab, label: "Upload" },
              { id: "library" as Tab, label: "Library" },
            ]
          ).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`ff-asset-tab-${entry.id}`}
              className={`flex-1 border-b-2 px-4 py-2.5 text-sm font-medium transition-[opacity] duration-150 ${
                tab === entry.id
                  ? "border-[color:var(--ff-primary)] text-[color:var(--ff-primary)]"
                  : "border-transparent text-[color:var(--ff-muted)] hover:text-[color:var(--ff-fg)]"
              }`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {altDraft ? (
          /* ---------- §10 alt-text prompt (target prop supports alt) ---------- */
          <div className="flex flex-col gap-3 p-4" data-testid="ff-asset-alt-step">
            {upload.phase === "scan-pending" ? (
              <p className="ff-set-note" data-testid="ff-asset-scan-pending" role="status">
                {UPLOAD_PHASE_LABEL["scan-pending"]}
              </p>
            ) : null}
            <label className="ff-field">
              <span>Alt text</span>
              <input
                type="text"
                value={altDraft.value}
                data-testid="ff-asset-alt-input"
                aria-label="Alt text"
                placeholder="Describe the image for screen readers"
                onChange={(event) => setAltDraft({ ...altDraft, value: event.target.value })}
              />
            </label>
            <p className="ff-set-note">Describe the image for accessibility (optional).</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} data-testid="ff-asset-alt-skip" onClick={() => resolveAlt(false)}>
                Skip
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                data-testid="ff-asset-alt-save"
                onClick={() => resolveAlt(true)}
              >
                Use image
              </button>
            </div>
          </div>
        ) : tab === "upload" ? (
          /* ------------------------------ Upload ----------------------------- */
          <div className="flex flex-col gap-3 p-4" data-testid="ff-asset-upload">
            <label className="ff-field">
              <span>Upload an image</span>
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                data-testid="ff-asset-file-input"
                aria-label="Choose an image file to upload"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = ""; // allow re-picking the same file
                  handleFile(file);
                }}
              />
            </label>
            <p className="ff-set-note">
              PNG, JPEG, GIF, WebP or AVIF — stored in your workspace, scanned before serving.
            </p>
            {uploadStatusLabel ? (
              <p className="ff-set-note" role="status" data-testid="ff-asset-upload-status">
                {uploadStatusLabel}
              </p>
            ) : null}
            {upload.phase === "error" ? (
              <p className="ff-banner ff-banner-error" role="alert" data-testid="ff-asset-upload-error">
                {upload.message}
              </p>
            ) : null}
            {upload.phase === "scan-pending" && !supportsAlt ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  data-testid="ff-asset-use-image"
                  onClick={() => onSelect({ assetId: upload.assetId })}
                >
                  Use image
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          /* ------------------------------ Library ---------------------------- */
          <div className="p-4" data-testid="ff-asset-library">
            {library.status === "loading" ? (
              <p className="ff-set-note py-6 text-center" role="status" data-testid="ff-asset-library-loading">
                Loading library…
              </p>
            ) : library.status === "error" ? (
              <p className="ff-banner ff-banner-error" role="alert" data-testid="ff-asset-library-error">
                {library.message}
              </p>
            ) : library.items.length === 0 ? (
              <p className="ff-set-note py-6 text-center" data-testid="ff-asset-library-empty">
                No images yet — upload your first one.
              </p>
            ) : (
              <ul
                id={listId}
                className="m-0 grid max-h-72 list-none grid-cols-2 gap-2 overflow-y-auto p-0 sm:grid-cols-3"
                data-testid="ff-asset-library-list"
              >
                {library.items.map((item) => {
                  const scanStatus = item.asset.scanStatus as ScanStatus;
                  const servable = isServable(scanStatus);
                  return (
                    <li key={item.asset.id}>
                      <button
                        type="button"
                        disabled={!servable}
                        onClick={() => pickLibraryItem(item)}
                        data-testid="ff-asset-item"
                        data-asset-id={item.asset.id}
                        title={servable ? undefined : scanLabel(scanStatus)}
                        className={`flex h-full w-full flex-col gap-2 rounded-xl border p-2 text-left text-sm transition-colors duration-150 ease-[var(--ff-ease-out)] ${
                          servable
                            ? "border-[color:var(--ff-border)] bg-[color:var(--ff-card)] hover:border-[color:var(--ff-primary)] focus-visible:border-[color:var(--ff-primary)] focus-visible:outline focus-visible:outline-[2px] focus-visible:outline-[color:var(--ff-primary)] focus-visible:-outline-offset-1"
                            : "border-[color:var(--ff-border)] opacity-60"
                        }`}
                      >
                        {item.download ? (
                          // Plain <img>: a signed storage URL, not a Next route.
                          <img
                            src={item.download.url}
                            alt=""
                            aria-hidden="true"
                            className="h-14 w-full shrink-0 rounded-lg border border-[color:var(--ff-border)] object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            style={{ background: "var(--ff-bg-2)" }}
                            className="flex h-14 w-full shrink-0 items-center justify-center rounded-lg text-lg"
                          >
                            🖼
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate" title={fileNameOf(item.asset.key)}>
                          {fileNameOf(item.asset.key)}
                        </span>
                        <span className={`${scanBadgeClass(scanStatus)} shrink-0 self-start`}>
                          {scanLabel(scanStatus)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="border-t border-[color:var(--ff-border)] px-4 py-2 text-[11px] text-[color:var(--ff-muted)]">
          Esc close{supportsAlt ? " · alt text is prompted after picking" : ""}
        </div>
      </div>
    </div>
  );
}
