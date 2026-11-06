// T16 — conversational `file-upload` input (spec §7.2 answer { assetIds },
// §10.2 one-question flow). The presign → PUT → confirm orchestration runs
// through the injectable UploadTransport + stubbed fetch (no network/DOM);
// markup is checked server-side like the other conversational inputs.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MSG_REQUIRED,
  normalizeAnswer,
  validateAnswer,
} from "../../validation/validateAnswer";
import {
  FileUploadInput,
  uploadFiles,
  type UploadTransport,
} from "../FileUpload";

const block = (patch: Record<string, unknown> = {}) => ({
  id: "b10",
  kind: "file-upload" as const,
  props: {
    label: "Attach your artwork",
    accept: ["image/png", ".pdf"],
    maxSizeMb: 10,
    maxFiles: 2,
    required: true,
    ...patch,
  },
});

const PNG_FILE = {
  name: "art.png",
  type: "image/png",
  size: 10 * 1024 * 1024, // exactly the cap — allowed
  body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

const OVER_CAP_FILE = {
  name: "big.png",
  type: "image/png",
  size: 10 * 1024 * 1024 + 1, // 10 MB + 1 byte
  body: new Uint8Array([0x89, 0x50]),
};

function fakeTransport(): UploadTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async presign(input) {
      calls.push(`presign:${input.fileName}:${input.mime}:${input.sizeBytes}`);
      return { assetId: `ast_${input.fileName}`, uploadUrl: `https://s3.test/${input.fileName}`, maxSizeMb: 10 };
    },
    async confirm(input) {
      calls.push(`confirm:${input.assetId}`);
      return { assetId: input.assetId, scanStatus: "pending" };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFiles — presign → PUT → confirm (public plane, §10.1)", () => {
  it("uploads each picked file and returns confirmed asset ids in order", async () => {
    const transport = fakeTransport();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFiles([PNG_FILE], {
      maxSizeMb: 10,
      remainingSlots: 2,
      transport,
    });

    expect(result).toEqual({ assetIds: ["ast_art.png"], error: null });
    expect(transport.calls).toEqual([
      "presign:art.png:image/png:10485760",
      "confirm:ast_art.png",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3.test/art.png",
      expect.objectContaining({ method: "PUT", headers: { "content-type": "image/png" } }),
    );
  });

  it("rejects over-cap files BEFORE any presign (mirrors the server cap)", async () => {
    const transport = fakeTransport();
    const result = await uploadFiles([OVER_CAP_FILE], { maxSizeMb: 10, remainingSlots: 1, transport });
    expect(result).toEqual({ assetIds: [], error: `"big.png" exceeds the 10 MB limit` });
    expect(transport.calls).toEqual([]); // no presign, no confirm
  });

  it("takes at most remainingSlots files (maxFiles already reached → no-op)", async () => {
    const transport = fakeTransport();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const result = await uploadFiles([PNG_FILE, PNG_FILE], { maxSizeMb: 10, remainingSlots: 1, transport });
    expect(result.assetIds).toHaveLength(1);
    expect(transport.calls).toHaveLength(2);
    const full = await uploadFiles([PNG_FILE], { maxSizeMb: 10, remainingSlots: 0, transport });
    expect(full).toEqual({ assetIds: [], error: null });
    expect(transport.calls).toHaveLength(2);
  });

  it("surfaces the §4 server error message (over-cap rejected late by the server)", async () => {
    const transport: UploadTransport = {
      async presign() {
        throw new Error("File exceeds the 10 MB upload limit");
      },
      async confirm() {
        throw new Error("unreachable");
      },
    };
    const result = await uploadFiles([PNG_FILE], { maxSizeMb: 10, remainingSlots: 1, transport });
    expect(result).toEqual({ assetIds: [], error: "File exceeds the 10 MB upload limit" });
  });

  it("maps a failed PUT to 'Upload failed'", async () => {
    const transport = fakeTransport();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const result = await uploadFiles([PNG_FILE], { maxSizeMb: 10, remainingSlots: 1, transport });
    expect(result).toEqual({ assetIds: [], error: "Upload failed" });
  });
});

describe("file-upload validation mirror (client feedback; server re-validates)", () => {
  it("required block with no files → required message", () => {
    expect(validateAnswer(block(), undefined)).toBe(MSG_REQUIRED);
    expect(validateAnswer(block(), { assetIds: [] })).toBe(MSG_REQUIRED);
  });

  it("a confirmed asset id satisfies a required block", () => {
    expect(validateAnswer(block(), { assetIds: ["ast_1"] })).toBeNull();
  });

  it("optional block passes empty", () => {
    expect(validateAnswer(block({ required: false }), undefined)).toBeNull();
  });

  it("more files than maxFiles → cap message; malformed ids rejected", () => {
    expect(validateAnswer(block({ maxFiles: 2 }), { assetIds: ["a", "b", "c"] })).toContain("at most 2");
    expect(validateAnswer(block(), { assetIds: [""] })).not.toBeNull();
    expect(validateAnswer(block(), { assetIds: "ast_1" })).not.toBeNull();
  });

  it("unsupported kinds never block (defensive mirror of machine helpers)", () => {
    expect(validateAnswer({ id: "x", kind: "section", props: {} }, undefined)).toBeNull();
  });
});

describe("normalizeAnswer — file-upload passthrough shape", () => {
  it("normalizes to { assetIds: string[] }", () => {
    expect(normalizeAnswer(block(), { assetIds: ["a", "b"] })).toEqual({ assetIds: ["a", "b"] });
    expect(normalizeAnswer(block(), undefined)).toEqual({ assetIds: [] });
    expect(normalizeAnswer(block(), { assetIds: ["a", 1] })).toEqual({ assetIds: ["a"] });
  });
});

describe("FileUploadInput markup (server-safe)", () => {
  const inputCommon = {
    blockId: "b10",
    labelId: "ff-label-b10",
    describedByIds: undefined,
    error: null as string | null,
    autoFocus: false,
    onChange: () => {},
    onSubmit: () => {},
  };

  it("renders a labelled file input with accept + multiple", () => {
    const html = renderToStaticMarkup(
      <FileUploadInput
        {...inputCommon}
        value={undefined}
        maxFiles={2}
        maxSizeMb={10}
        accept={["image/png", ".pdf"]}
      />,
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,.pdf"');
    expect(html).toContain("multiple");
    expect(html).toContain('aria-labelledby="ff-label-b10"');
  });

  it("omits multiple for single-file blocks and lists attached files", () => {
    const html = renderToStaticMarkup(
      <FileUploadInput
        {...inputCommon}
        value={{ assetIds: ["ast_1"] }}
        maxFiles={1}
        maxSizeMb={10}
        accept={[]}
      />,
    );
    expect(html).not.toContain("multiple");
    expect(html).toContain('data-asset-id="ast_1"');
    expect(html).toContain("1/1 files");
  });

  it("renders the inline error", () => {
    const html = renderToStaticMarkup(
      <FileUploadInput
        {...inputCommon}
        value={undefined}
        maxFiles={1}
        maxSizeMb={10}
        accept={[]}
        error="Upload failed"
      />,
    );
    expect(html).toContain("Upload failed");
    expect(html).toContain('role="alert"');
  });
});
