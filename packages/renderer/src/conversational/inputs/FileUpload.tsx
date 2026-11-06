"use client";

// file-upload input (T16, spec §7.2 answer { assetIds } + §10.1 upload plane).
//
// Every picked file goes direct-to-storage: presign (public API) → PUT →
// confirm (magic-byte check + scan queue). Only confirmed asset ids enter the
// answer, so a submission can never reference bytes the server did not sniff.
// Client-side caps mirror the server for fast feedback — the server stays the
// gate (10 MB cap, MIME allowlist, magic bytes at confirm).
import { useState, type FC } from "react";
import type { QuestionInputCommon } from "./shared";
import { swallowEscape } from "./shared";

/** Transport seam for the presign/confirm dance (injectable in tests + embeds). */
export type UploadTransport = {
  presign(input: {
    fileName: string;
    mime: string;
    sizeBytes: number;
  }): Promise<{ assetId: string; uploadUrl: string; maxSizeMb: number }>;
  confirm(input: { assetId: string }): Promise<{ assetId: string; scanStatus: string }>;
};

function parseErrorBody(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    return parsed.error?.message ?? "Upload failed";
  } catch {
    return "Upload failed";
  }
}

/** Default transport — the public upload plane (unauthenticated by design). */
export const fetchUploadTransport: UploadTransport = {
  async presign(input) {
    const res = await fetch("/api/public/uploads/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(parseErrorBody(text));
    return JSON.parse(text) as { assetId: string; uploadUrl: string; maxSizeMb: number };
  },
  async confirm(input) {
    const res = await fetch("/api/public/uploads/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(parseErrorBody(text));
    return JSON.parse(text) as { assetId: string; scanStatus: string };
  },
};

let activeTransport: UploadTransport = fetchUploadTransport;

/** Test/embed seam: swap the transport (node tests must not hit the network). */
export function setFileUploadTransport(transport: UploadTransport): void {
  activeTransport = transport;
}

/** Structural file view — real Files (browser) and test doubles both fit. */
export type UploadableFile = {
  name: string;
  type: string;
  size: number;
  /** Bytes to PUT; real files pass the File itself. */
  body: unknown;
};

const MB = 1024 * 1024;

/**
 * Orchestrates presign → PUT → confirm for a batch of picked files.
 * Pure-ish (fetch for the PUT, injected transport for presign/confirm) so the
 * flow is unit-tested without a DOM. Returns the new asset ids or an error
 * message for `role="alert"` display.
 */
export async function uploadFiles(
  files: readonly UploadableFile[],
  options: {
    /** Block-level per-file cap (props.maxSizeMb). */
    maxSizeMb: number;
    /** How many more files may be attached (maxFiles - current length). */
    remainingSlots: number;
    transport: UploadTransport;
  },
): Promise<{ assetIds: string[]; error: string | null }> {
  if (files.length === 0 || options.remainingSlots <= 0) {
    return { assetIds: [], error: null };
  }
  const batch = files.slice(0, options.remainingSlots);

  const tooBig = batch.find((file) => file.size > options.maxSizeMb * MB);
  if (tooBig) {
    return {
      assetIds: [],
      error: `"${tooBig.name}" exceeds the ${options.maxSizeMb} MB limit`,
    };
  }

  const assetIds: string[] = [];
  try {
    for (const file of batch) {
      const contentType = file.type !== "" ? file.type : "application/octet-stream";
      const presigned = await options.transport.presign({
        fileName: file.name,
        mime: contentType,
        sizeBytes: file.size,
      });
      const put = await fetch(presigned.uploadUrl, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: file.body as BodyInit,
      });
      if (!put.ok) throw new Error("Upload failed");
      const confirmed = await options.transport.confirm({ assetId: presigned.assetId });
      assetIds.push(confirmed.assetId);
    }
    return { assetIds, error: null };
  } catch (err) {
    return { assetIds: [], error: err instanceof Error ? err.message : "Upload failed" };
  }
}

export interface FileUploadInputProps extends QuestionInputCommon {
  /** Accepted types: `<mime>` ("image/png"), `<ext>` (".pdf"), `mime/*`. */
  accept?: string[];
  /** Per-file cap in MB (block prop, always ≤ 10 server-side). */
  maxSizeMb?: number;
  /** How many files may be attached (answer assetIds cap). */
  maxFiles?: number;
}

/** `{ assetIds: string[] }` — ids returned by the confirm endpoint. */
function assetIdsOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const ids = (value as { assetIds?: unknown }).assetIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

export function FileUploadInput(props: FileUploadInputProps) {
  const { value, error, onChange, labelId, describedByIds, autoFocus, accept, maxSizeMb, maxFiles } = props;
  const current = assetIdsOf(value);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const capMb = maxSizeMb ?? 10;
  const maxFilesCount = maxFiles ?? 1;
  const remaining = Math.max(0, maxFilesCount - current.length);

  async function handleFiles(fileList: FileList | null): Promise<void> {
    setUploadError(null);
    if (!fileList || fileList.length === 0) return;
    const files: UploadableFile[] = Array.from(fileList).map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      body: file,
    }));
    setBusy(true);
    const result = await uploadFiles(files, { maxSizeMb: capMb, remainingSlots: remaining, transport: activeTransport });
    setBusy(false);
    if (result.error) {
      setUploadError(result.error);
      return;
    }
    if (result.assetIds.length > 0) {
      onChange({ assetIds: [...current, ...result.assetIds] });
    }
  }

  function removeAsset(assetId: string): void {
    onChange({ assetIds: current.filter((id) => id !== assetId) });
  }

  const showError = uploadError ?? error;

  return (
    <div>
      <input
        className="ff-input ff-input-file"
        type="file"
        accept={(accept ?? []).join(",")}
        multiple={maxFilesCount > 1}
        disabled={busy || remaining === 0}
        autoFocus={autoFocus}
        aria-labelledby={labelId}
        aria-describedby={describedByIds}
        aria-invalid={showError ? true : undefined}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = ""; // allow re-picking the same file
        }}
        onKeyDown={swallowEscape}
      />
      {busy ? (
        <p className="ff-hint" role="status">
          Uploading…
        </p>
      ) : null}
      {showError ? (
        <p role="alert" className="ff-error">
          {showError}
        </p>
      ) : null}
      {current.length > 0 ? (
        <ul className="ff-file-list">
          {current.map((assetId) => (
            <li key={assetId} className="ff-file-item" data-asset-id={assetId}>
              <span>📎 {assetId}</span>
              <button type="button" aria-label="Remove file" onClick={() => removeAsset(assetId)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {maxFilesCount > 1 || current.length > 0 ? (
        <p className="ff-hint" aria-hidden="true">
          {current.length}/{maxFilesCount} files
        </p>
      ) : null}
    </div>
  );
}

/** Guard for tests/typing — keeps the FC export symmetric with other inputs. */
export const FileUploadInputFC: FC<FileUploadInputProps> = FileUploadInput;
