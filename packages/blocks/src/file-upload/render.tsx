// packages/blocks — `file-upload` public renderer (client-interactive).
//
// T16 upload flow (spec §10.1): every picked file goes through
//   1. POST /api/public/uploads/presign  → { assetId, uploadUrl, maxSizeMb }
//   2. PUT  uploadUrl with the raw bytes  (direct-to-S3, never proxied)
//   3. POST /api/public/uploads/confirm   → magic-byte check + scan queue
// and only then lands in the answer as `{ assetIds: [...] }`. Client-side
// size checks mirror the server caps for fast feedback — the server (10 MB
// cap, MIME allowlist, magic bytes) is the actual gate.
import { useState, type FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import {
  acceptAttributeValue,
  type FileUploadAnswer,
  type FileUploadProps,
} from "./schema";

/** Transport seam for the presign/confirm dance (injectable in tests). */
export type UploadClient = {
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

/** Default client — the public upload plane (works unauthenticated). */
export const fetchUploadClient: UploadClient = {
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

let activeClient: UploadClient = fetchUploadClient;

/** Test seam: swap the transport (jsdom-less tests must not hit the network). */
export function setFileUploadClient(client: UploadClient): void {
  activeClient = client;
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
 * Pure-ish (fetch for the PUT, injected client for presign/confirm) so the
 * flow is unit-tested without a DOM. Returns the new asset ids or an error
 * message suitable for `role="alert"` display.
 */
export async function uploadFileAnswer(
  files: readonly UploadableFile[],
  options: {
    /** Block-level per-file cap (props.maxSizeMb). */
    maxSizeMb: number;
    /** How many more files may be attached (props.maxFiles - current.length). */
    remainingSlots: number;
    client: UploadClient;
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
      const presigned = await options.client.presign({
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
      const confirmed = await options.client.confirm({ assetId: presigned.assetId });
      assetIds.push(confirmed.assetId);
    }
    return { assetIds, error: null };
  } catch (err) {
    return { assetIds: [], error: err instanceof Error ? err.message : "Upload failed" };
  }
}

export const FileUploadRender: FC<RenderProps<FileUploadProps, FileUploadAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
}) => {
  const current: string[] = Array.isArray(answer?.assetIds) ? answer.assetIds : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, props.maxFiles - current.length);

  async function handleFiles(fileList: FileList | null): Promise<void> {
    setError(null);
    if (!fileList || fileList.length === 0) return;
    const files: UploadableFile[] = Array.from(fileList).map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      body: file,
    }));
    setBusy(true);
    const result = await uploadFileAnswer(files, {
      maxSizeMb: props.maxSizeMb,
      remainingSlots: remaining,
      client: activeClient,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.assetIds.length > 0) {
      onAnswer?.({ assetIds: [...current, ...result.assetIds] });
    }
  }

  function removeAsset(assetId: string): void {
    onAnswer?.({ assetIds: current.filter((id) => id !== assetId) });
  }

  return (
    <QuestionShell kind="file-upload" label={props.label} required={props.required} description={props.description}>
      <input
        type="file"
        name="answer"
        data-testid="file-upload-input"
        accept={acceptAttributeValue(props.accept)}
        multiple={props.maxFiles > 1}
        disabled={disabled || busy || remaining === 0}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = ""; // allow re-picking the same file
        }}
      />
      {busy ? <p className="ff-file-upload__status">Uploading…</p> : null}
      {error ? (
        <p className="ff-file-upload__error" role="alert" data-testid="file-upload-error">
          {error}
        </p>
      ) : null}
      {current.length > 0 ? (
        <ul className="ff-file-upload__files" data-testid="file-upload-files">
          {current.map((assetId) => (
            <li key={assetId} className="ff-file-upload__file" data-asset-id={assetId}>
              <span>📎 {assetId}</span>
              {disabled ? null : (
                <button
                  type="button"
                  aria-label="Remove file"
                  onClick={() => removeAsset(assetId)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {props.maxFiles > 1 && remaining > 0 ? (
        <p className="ff-file-upload__hint">
          {current.length}/{props.maxFiles} files
        </p>
      ) : null}
    </QuestionShell>
  );
};
