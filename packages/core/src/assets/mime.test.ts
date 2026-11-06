// T16 — magic-byte sniffing + MIME allowlist (spec §17: "Uploads: size cap,
// MIME allowlist, magic-byte check"). The sniffed content type is the security
// boundary: a renamed .exe claiming image/png must be rejected.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPLOAD_MIME_ALLOWLIST,
  familyOf,
  isAllowedUploadMime,
  isTypeSpoof,
  sniffMime,
} from "./mime.ts";

const bytes = (...vals: number[]): Uint8Array => new Uint8Array(vals);
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// Real signatures (spec-literal magic numbers).
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const GIF89A = ascii("GIF89a....");
const WEBP = cat(ascii("RIFF"), bytes(0, 0, 0, 0), ascii("WEBPVP8 "));
const AVIF = ascii("....ftypavif....");
const PDF = ascii("%PDF-1.7\n...");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const EXE = cat(ascii("MZ"), bytes(0x90, 0x00, 0x03, 0x00));
const GZIP = bytes(0x1f, 0x8b, 0x08, 0x00);

describe("sniffMime — magic-byte detection", () => {
  it("detects png/jpeg/gif/webp/avif signatures", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(GIF89A)).toBe("image/gif");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(AVIF)).toBe("image/avif");
  });

  it("detects pdf/zip/gzip containers (docx/xlsx are zip)", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(ZIP)).toBe("application/zip");
    expect(sniffMime(GZIP)).toBe("application/gzip");
  });

  it("detects Windows executables so they can never pass as images", () => {
    expect(sniffMime(EXE)).toBe("application/x-msdownload");
  });

  it("detects svg markup and plain utf-8 text", () => {
    expect(sniffMime(ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      "image/svg+xml",
    );
    expect(sniffMime(ascii("hello, world\n"))).toBe("text/plain");
    expect(sniffMime(ascii("a,b,c\n1,2,3\n"))).toBe("text/plain");
  });

  it("returns null for unknown binary content and empty input", () => {
    expect(sniffMime(bytes(0xde, 0xad, 0xbe, 0xef, 0x00, 0x01))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
});

describe("isAllowedUploadMime — default allowlist", () => {
  it("covers the spec-relevant families", () => {
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/zip",
    ]) {
      expect(isAllowedUploadMime(mime)).toBe(true);
    }
  });

  it("rejects executables, scripts and arbitrary types", () => {
    for (const mime of [
      "application/x-msdownload",
      "application/x-httpd-php",
      "text/html",
      "application/javascript",
      "application/octet-stream",
    ]) {
      expect(isAllowedUploadMime(mime)).toBe(false);
    }
  });

  // SPEC-NOTE: image/svg+xml is sniffable but deliberately NOT on the default
  // allowlist — inline SVG is an active-content XSS vector (spec §17 CSP goal).
  // The block-level `accept` prop can widen client hints, never server policy.
  it("excludes svg (active content) by default", () => {
    expect(DEFAULT_UPLOAD_MIME_ALLOWLIST).not.toContain("image/svg+xml");
    expect(isAllowedUploadMime("image/svg+xml")).toBe(false);
  });
});

describe("type-spoof detection", () => {
  it("accepts exact and same-family declared/sniffed pairs", () => {
    expect(isTypeSpoof("image/png", "image/png")).toBe(false);
    // csv/txt both sniff as text/plain; xlsx/docx sniff as application/zip.
    expect(isTypeSpoof("text/csv", "text/plain")).toBe(false);
    expect(
      isTypeSpoof("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"),
    ).toBe(false);
  });

  it("flags the renamed .exe spoof (security boundary)", () => {
    // "photo.png" whose bytes are a PE executable:
    expect(sniffMime(EXE)).toBe("application/x-msdownload");
    expect(isTypeSpoof("image/png", "application/x-msdownload")).toBe(true);
    // And it fails the allowlist regardless of the declared type:
    expect(isAllowedUploadMime(sniffMime(EXE) ?? "")).toBe(false);
  });

  it("flags cross-family mismatches (zip bytes declared as png)", () => {
    expect(isTypeSpoof("image/png", "application/zip")).toBe(true);
    expect(isTypeSpoof("image/png", "text/plain")).toBe(true);
  });
});

describe("familyOf", () => {
  it("groups csv/txt and openxml/zip", () => {
    expect(familyOf("text/csv")).toBe("text");
    expect(familyOf("text/plain")).toBe("text");
    expect(familyOf("application/zip")).toBe("archive");
    expect(familyOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("archive");
    expect(familyOf("image/webp")).toBe("image");
    expect(familyOf("application/pdf")).toBe("document");
  });
});
