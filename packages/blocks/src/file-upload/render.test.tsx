// T16 — `file-upload` render + upload orchestration. The presign → PUT →
// confirm flow runs through the injectable UploadClient + stubbed fetch, so
// no network/DOM is required; markup is checked server-side.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { uploadFileAnswer, type UploadClient } from "./render";
import { FileUploadRender } from "./render";
import { FileUploadProps, fileUploadDefaultProps } from "./schema";

const props = (patch: Partial<FileUploadProps> = {}): FileUploadProps => ({
  ...fileUploadDefaultProps(),
  ...patch,
});

const PNG_FILE = {
  name: "photo.png",
  type: "image/png",
  size: 10 * 1024 * 1024, // exactly the default cap — allowed
  body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

const OVER_CAP_FILE = {
  name: "big.png",
  type: "image/png",
  size: 10 * 1024 * 1024 + 1, // 10 MB + 1 byte
  body: new Uint8Array([0x89, 0x50]),
};

function fakeClient(overrides: Partial<UploadClient> = {}): UploadClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async presign(input) {
      calls.push(`presign:${input.fileName}:${input.mime}`);
      return { assetId: `ast_${input.fileName}`, uploadUrl: `https://s3.test/${input.fileName}`, maxSizeMb: 10 };
    },
    async confirm(input) {
      calls.push(`confirm:${input.assetId}`);
      return { assetId: input.assetId, scanStatus: "pending" };
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFileAnswer — presign → PUT → confirm", () => {
  it("uploads each file and returns confirmed asset ids in order", async () => {
    const client = fakeClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const result = await uploadFileAnswer([PNG_FILE], { maxSizeMb: 10, remainingSlots: 1, client });
    expect(result).toEqual({ assetIds: ["ast_photo.png"], error: null });
    expect(client.calls).toEqual([
      "presign:photo.png:image/png",
      "confirm:ast_photo.png",
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://s3.test/photo.png",
      expect.objectContaining({ method: "PUT", headers: { "content-type": "image/png" } }),
    );
  });

  it("rejects over-cap files BEFORE presigning (mirrors server cap)", async () => {
    const client = fakeClient();
    const result = await uploadFileAnswer([OVER_CAP_FILE], { maxSizeMb: 10, remainingSlots: 1, client });
    expect(result.error).toBe(`"big.png" exceeds the 10 MB limit`);
    expect(result.assetIds).toEqual([]);
    expect(client.calls).toEqual([]); // no presign, no confirm
  });

  it("respects the remaining slot count (maxFiles already reached)", async () => {
    const client = fakeClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const result = await uploadFileAnswer(
      [PNG_FILE, PNG_FILE],
      { maxSizeMb: 10, remainingSlots: 1, client },
    );
    expect(result.assetIds).toHaveLength(1);
    expect(client.calls).toHaveLength(2); // presign+confirm once
  });

  it("surfaces server error messages from the §4 error body", async () => {
    const client = fakeClient({
      async presign() {
        throw new Error("File exceeds the 10 MB upload limit");
      },
    });
    const result = await uploadFileAnswer([PNG_FILE], { maxSizeMb: 10, remainingSlots: 1, client });
    expect(result.error).toBe("File exceeds the 10 MB upload limit");
  });

  it("maps a failed PUT to 'Upload failed'", async () => {
    const client = fakeClient();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const result = await uploadFileAnswer([PNG_FILE], { maxSizeMb: 10, remainingSlots: 1, client });
    expect(result.error).toBe("Upload failed");
  });
});

describe("FileUploadRender markup (server-safe)", () => {
  const markup = (element: React.ReactElement): string => renderToStaticMarkup(element);

  it("renders a file input with accept + multiple attributes", () => {
    const html = markup(
      <FileUploadRender
        props={props({ label: "Attachments", maxFiles: 3, accept: ["image/png", ".pdf"] })}
      />,
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,.pdf"');
    expect(html).toContain("multiple");
    expect(html).toContain("Attachments");
  });

  it("omits multiple for single-file blocks", () => {
    const html = markup(<FileUploadRender props={fileUploadDefaultProps()} />);
    expect(html).not.toContain("multiple");
  });

  it("lists the current asset ids (visible with their asset reference)", () => {
    const html = markup(
      <FileUploadRender
        props={fileUploadDefaultProps()}
        answer={{ assetIds: ["ast_1", "ast_2"] }}
      />,
    );
    expect(html).toContain("data-asset-id=\"ast_1\"");
    expect(html).toContain("data-asset-id=\"ast_2\"");
  });
});
