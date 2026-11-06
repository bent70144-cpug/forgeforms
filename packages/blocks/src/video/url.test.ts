// T21 — YouTube/Vimeo allowlist (spec §7.2 `video`: url (YouTube/Vimeo allowlist)).
// Security stance: exact-hostname matching (never suffix matching) so lookalikes
// like `youtube.com.evil.io` or `not-youtube.com` are rejected.
import { describe, expect, it } from "vitest";
import { isAllowedVideoUrl, toEmbedUrl, videoEmbedHost } from "./url";

describe("isAllowedVideoUrl — YouTube/Vimeo allowlist", () => {
  it("accepts canonical YouTube and Vimeo URLs", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=abc123",
      "https://m.youtube.com/watch?v=abc123",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://www.vimeo.com/76979871",
      "https://player.vimeo.com/video/76979871",
    ]) {
      expect(isAllowedVideoUrl(url), url).toBe(true);
    }
  });

  it("accepts http for local development", () => {
    expect(isAllowedVideoUrl("http://www.youtube.com/watch?v=x")).toBe(true);
  });

  it("rejects lookalike hosts (exact-hostname match, no suffix match)", () => {
    expect(isAllowedVideoUrl("https://youtube.com.evil.io/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("https://evil-youtube.com/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("https://notyoutube.com/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("https://vimeo.com.example.net/76979871")).toBe(false);
    expect(isAllowedVideoUrl("https://youtu.be.evil.io/x")).toBe(false);
    expect(isAllowedVideoUrl("https://fake-youtube.com.evil.io/watch?v=x")).toBe(false);
  });

  it("rejects arbitrary subdomains of allowlisted hosts", () => {
    // www./m./player. are allowlisted explicitly; other subdomains are not.
    expect(isAllowedVideoUrl("https://malicious.youtube.com/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("https://cdn.vimeo.com/123")).toBe(false);
  });

  it("rejects non-allowlisted hosts entirely", () => {
    expect(isAllowedVideoUrl("https://example.com/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("https://dailymotion.com/video/x")).toBe(false);
  });

  it("rejects non-http(s) schemes and relative/garbage URLs", () => {
    expect(isAllowedVideoUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedVideoUrl("data:text/html,<script>")).toBe(false);
    expect(isAllowedVideoUrl("ftp://youtube.com/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("/watch?v=x")).toBe(false);
    expect(isAllowedVideoUrl("not a url")).toBe(false);
    expect(isAllowedVideoUrl("")).toBe(false);
  });
});

describe("toEmbedUrl — canonical player URLs for the iframe src", () => {
  it("converts a YouTube watch URL to the nocookie embed player", () => {
    expect(toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });

  it("converts a youtu.be short link", () => {
    expect(toEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });

  it("converts YouTube shorts/embed/live paths", () => {
    expect(toEmbedUrl("https://www.youtube.com/shorts/xyz_-123")).toBe(
      "https://www.youtube-nocookie.com/embed/xyz_-123?rel=0",
    );
    expect(toEmbedUrl("https://www.youtube.com/embed/abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc?rel=0",
    );
    expect(toEmbedUrl("https://www.youtube.com/live/abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc?rel=0",
    );
  });

  it("converts Vimeo page URLs to the player", () => {
    expect(toEmbedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(toEmbedUrl("https://www.vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(toEmbedUrl("https://player.vimeo.com/video/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
  });

  it("returns null for non-allowlisted or id-less URLs (render degrades to a link)", () => {
    expect(toEmbedUrl("https://youtube.com.evil.io/watch?v=x")).toBeNull();
    expect(toEmbedUrl("https://vimeo.com/")).toBeNull();
    expect(toEmbedUrl("https://www.youtube.com/watch")).toBeNull();
    expect(toEmbedUrl("https://example.com/watch?v=x")).toBeNull();
    expect(toEmbedUrl("garbage")).toBeNull();
  });

  it("videoEmbedHost reports the provider for tests/editors", () => {
    expect(videoEmbedHost("https://www.youtube.com/watch?v=x")).toBe("youtube");
    expect(videoEmbedHost("https://vimeo.com/123")).toBe("vimeo");
    expect(videoEmbedHost("https://example.com/x")).toBeNull();
  });
});
