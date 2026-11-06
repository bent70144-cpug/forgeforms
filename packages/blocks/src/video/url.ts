// packages/blocks — `video` URL helpers (spec §7.2: YouTube/Vimeo allowlist).
//
// Security stance: exact-hostname allowlist (Set membership on the parsed
// hostname, lowercased) — never suffix/substring matching, so lookalikes like
// `youtube.com.evil.io` or `not-youtube.com` are rejected. Only http(s) URLs
// parse; everything else (javascript:, data:, relative) is rejected.

const YT_EMBED_BASE = "https://www.youtube-nocookie.com/embed/";
const VIMEO_PLAYER_BASE = "https://player.vimeo.com/video/";

export const VIDEO_HOST_ALLOWLIST: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
];

const ALLOWED = new Set<string>(VIDEO_HOST_ALLOWLIST);

function parseHttpUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed;
}

/** True when `url` points at an allowlisted YouTube/Vimeo host over http(s). */
export function isAllowedVideoUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return false;
  return ALLOWED.has(parsed.hostname.toLowerCase());
}

export type VideoEmbedHost = "youtube" | "vimeo";

/** Which provider the (allowlisted) URL belongs to; null otherwise. */
export function videoEmbedHost(url: string): VideoEmbedHost | null {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") return "vimeo";
  if (ALLOWED.has(host)) return "youtube";
  return null;
}

function firstPathSegment(parsed: URL): string {
  return parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
}

/**
 * Canonical iframe src for an allowlisted video URL; null when the provider or
 * the video id cannot be determined (renderers degrade to a plain link).
 */
export function toEmbedUrl(url: string): string | null {
  if (!isAllowedVideoUrl(url)) return null;
  const parsed = parseHttpUrl(url);
  if (parsed === null) return null;
  const host = parsed.hostname.toLowerCase();

  if (host === "vimeo.com" || host === "www.vimeo.com") {
    const id = firstPathSegment(parsed);
    return /^\d{1,12}$/.test(id) ? `${VIMEO_PLAYER_BASE}${id}` : null;
  }
  if (host === "player.vimeo.com") {
    const match = parsed.pathname.match(/^\/video\/(\d{1,12})(?:[/?#]|$)/);
    return match ? `${VIMEO_PLAYER_BASE}${match[1]}` : null;
  }

  // YouTube family.
  const id =
    host === "youtu.be"
      ? firstPathSegment(parsed)
      : (parsed.searchParams.get("v") ??
        parsed.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]+)/)?.[1] ??
        "");
  return id !== "" ? `${YT_EMBED_BASE}${encodeURIComponent(id)}?rel=0` : null;
}
