// T16 (issue #16) — assets: magic-byte sniffing + MIME allowlist.
//
// Spec §17 security checklist: "Uploads: size cap, MIME allowlist, magic-byte
// check, scan before download, signed URLs only." The *sniffed* type — never
// the client-declared one — is the security boundary.

/** MIME types accepted by the upload plane. THE server-side gate. */
export const DEFAULT_UPLOAD_MIME_ALLOWLIST: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  // OpenXML (docx/xlsx/pptx) files are zip containers; the family check below
  // accepts them against sniffed "application/zip" without listing every brand.
]);

/**
 * Detect the content type from the file's leading magic bytes (not its name,
 * not its declared Content-Type). Returns `null` for unknown content — which
 * callers must treat as "reject" (fail closed).
 *
 * `application/x-msdownload` is detected explicitly so a renamed .exe can
 * never masquerade as an image; it is not on the allowlist.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;

  const startsWith = (...sig: number[]): boolean => sig.every((b, i) => bytes[i] === b);
  const asciiAt = (offset: number, text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };

  // Images
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (asciiAt(0, "GIF87a") || asciiAt(0, "GIF89a")) return "image/gif";
  if (asciiAt(0, "RIFF") && bytes.length >= 12 && asciiAt(8, "WEBP")) return "image/webp";
  // ISO-BMFF containers (AVIF/HEIF): "ftyp" at offset 4, brand at 8.
  if (bytes.length >= 12 && asciiAt(4, "ftyp")) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) {
      return null; // HEIC is not on the allowlist; unknown → reject
    }
  }

  // Documents / archives
  if (asciiAt(0, "%PDF-")) return "application/pdf";
  if (startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06) || startsWith(0x50, 0x4b, 0x07, 0x08)) {
    return "application/zip";
  }
  if (startsWith(0x1f, 0x8b)) return "application/gzip";

  // Windows executables (MZ header) — detected so type spoofs fail loudly.
  if (startsWith(0x4d, 0x5a)) return "application/x-msdownload";

  // Active-content text formats (never allowlisted, but identified for the
  // rejection message): SVG anywhere in the leading window.
  const headText = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).toLowerCase();
  if (headText.includes("<svg")) return "image/svg+xml";

  // Plain text heuristic: decodable UTF-8 without NUL/control garbage.
  if (looksLikeText(bytes)) return "text/plain";

  return null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const window = bytes.slice(0, 1024);
  if (window.length === 0) return false;
  let decodeFailed = false;
  const decoded = new TextDecoder("utf-8", {
    fatal: true,
    // eslint-disable-next-line @typescript-eslint/no-useless-catch -- intentionally scoped
  });
  let text: string;
  try {
    text = decoded.decode(window);
  } catch {
    decodeFailed = true;
    text = "";
  }
  if (decodeFailed) return false;
  if (text.includes("\u0000")) return false;
  // printable ASCII / whitespace / common Unicode — reject heavy control bytes
  let control = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) control++;
  }
  return control <= Math.floor(text.length * 0.05);
}

/** Coarse family used for declared↔sniffed compatibility (csv≈txt, docx≈zip). */
export function familyOf(mime: string): "image" | "text" | "archive" | "document" | "other" {
  const normalized = mime.toLowerCase().split(";")[0]!.trim();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("text/")) return "text";
  if (
    normalized === "application/zip" ||
    normalized === "application/x-zip-compressed" ||
    normalized.startsWith("application/vnd.openxmlformats-officedocument.") ||
    normalized === "application/gzip" ||
    normalized === "application/x-tar" ||
    normalized === "application/x-7z-compressed" ||
    normalized === "application/x-rar-compressed"
  ) {
    return "archive";
  }
  if (normalized === "application/pdf") return "document";
  return "other";
}

export function isAllowedUploadMime(mime: string, allowlist: readonly string[] = DEFAULT_UPLOAD_MIME_ALLOWLIST): boolean {
  const normalized = mime.toLowerCase().split(";")[0]!.trim();
  if (normalized === "image/svg+xml") return false; // active content — never
  return allowlist.includes(normalized);
}

/**
 * Type-spoof check: the sniffed content type must be compatible with the
 * client-declared one. `false` = compatible (no spoof), `true` = spoof.
 * Unknown sniffed content always spoofs (fail closed).
 */
export function isTypeSpoof(declaredMime: string, sniffedMime: string | null): boolean {
  if (sniffedMime === null) return true;
  if (sniffedMime === "image/svg+xml" || sniffedMime === "application/x-msdownload") return true;
  const declared = declaredMime.toLowerCase().split(";")[0]!.trim();
  if (declared === sniffedMime) return false;
  return familyOf(declared) !== familyOf(sniffedMime);
}

/** Bytes needed for a reliable sniff (ISO-BMFF brand + text window). */
export const SNIFF_WINDOW_BYTES = 64;
