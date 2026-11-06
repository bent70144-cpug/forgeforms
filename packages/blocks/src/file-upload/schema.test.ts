// T16 — `file-upload` block schema + validate (spec §7.2 row: label,
// accept[], maxSizeMb(≤10), maxFiles | answer { assetIds: string[] }).
import { describe, expect, it } from "vitest";
import {
  FILE_UPLOAD_BLOCK_MAX_MB,
  FileUploadAnswer,
  FileUploadProps,
  acceptAttributeValue,
  fileUploadDefaultProps,
  prefillFileUpload,
  validateFileUpload,
} from "./schema";

const props = (patch: Partial<FileUploadProps> = {}): FileUploadProps => ({
  ...fileUploadDefaultProps(),
  ...patch,
});

describe("FileUploadProps schema", () => {
  it("defaults to 10 MB / 1 file / no accept filter (spec §7.2 ceiling)", () => {
    const parsed = FileUploadProps.parse({ label: "Attachments" });
    expect(parsed.maxSizeMb).toBe(10);
    expect(parsed.maxFiles).toBe(1);
    expect(parsed.accept).toEqual([]);
    expect(parsed.required).toBe(false);
    expect(FILE_UPLOAD_BLOCK_MAX_MB).toBe(10);
  });

  it("caps maxSizeMb at 10 (spec §7.2 'maxSizeMb(≤10)')", () => {
    expect(FileUploadProps.safeParse({ label: "x", maxSizeMb: 11 }).success).toBe(false);
    expect(FileUploadProps.safeParse({ label: "x", maxSizeMb: 10 }).success).toBe(true);
    expect(FileUploadProps.safeParse({ label: "x", maxSizeMb: 0 }).success).toBe(false);
  });

  it("bounds maxFiles 1..10 and accept entries", () => {
    expect(FileUploadProps.safeParse({ label: "x", maxFiles: 0 }).success).toBe(false);
    expect(FileUploadProps.safeParse({ label: "x", maxFiles: 11 }).success).toBe(false);
    expect(FileUploadProps.safeParse({ label: "x", maxFiles: 5 }).success).toBe(true);
    expect(FileUploadProps.safeParse({ label: "x", accept: ["image/png", ".pdf"] }).success).toBe(true);
    expect(FileUploadProps.safeParse({ label: "x", accept: ["bad entry!"] }).success).toBe(false);
  });

  it("answer schema is exactly { assetIds: string[] } (§7.2 answer column)", () => {
    expect(FileUploadAnswer.safeParse({ assetIds: ["ast_1"] }).success).toBe(true);
    expect(FileUploadAnswer.safeParse({ assetIds: [] }).success).toBe(true);
    expect(FileUploadAnswer.safeParse({ assetIds: [""] }).success).toBe(false);
    expect(FileUploadAnswer.safeParse({ assetIds: [1] }).success).toBe(false);
    expect(FileUploadAnswer.safeParse({ files: ["ast_1"] }).success).toBe(false);
  });
});

describe("validateFileUpload", () => {
  it("passes a valid set of asset ids", () => {
    expect(validateFileUpload({ assetIds: ["a1", "a2"] }, props({ maxFiles: 3 }))).toBeNull();
  });

  it("requires a file when required", () => {
    expect(validateFileUpload({ assetIds: [] }, props({ required: true }))).toBe("This field is required");
    expect(validateFileUpload({ assetIds: [] }, props({ required: false }))).toBeNull();
  });

  it("enforces the maxFiles cap", () => {
    const p = props({ maxFiles: 2 });
    expect(validateFileUpload({ assetIds: ["a", "b"] }, p)).toBeNull();
    expect(validateFileUpload({ assetIds: ["a", "b", "c"] }, p)).toBe("Attach at most 2 files");
    const single = props({ maxFiles: 1 });
    expect(validateFileUpload({ assetIds: ["a", "b"] }, single)).toBe("Attach at most 1 file");
  });

  it("rejects empty/duplicate asset ids", () => {
    expect(validateFileUpload({ assetIds: ["a", ""] }, props())).toBe("Invalid asset reference");
    expect(validateFileUpload({ assetIds: ["a", "a"] }, props({ maxFiles: 2 }))).toBe(
      "Duplicate files are not allowed",
    );
  });
});

describe("acceptAttributeValue + prefill", () => {
  it("joins accept entries for the input attribute", () => {
    expect(acceptAttributeValue(["image/png", ".pdf"])).toBe("image/png,.pdf");
    expect(acceptAttributeValue([])).toBe("");
  });

  it("never prefills file answers from URL params", () => {
    expect(prefillFileUpload(props(), { upload: "ast_x" })).toBeUndefined();
  });
});
