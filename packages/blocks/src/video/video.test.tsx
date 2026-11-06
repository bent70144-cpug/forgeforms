// T21 — `video` schema: the YouTube/Vimeo allowlist is enforced at the props
// schema level (acceptance: "Video only allows allowlisted hosts (unit test
// rejects others)"). URL conversion details live in ./url.test.ts.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoProps, videoDefaultProps } from "./schema";
import { VideoRender } from "./render";

describe("video props schema (allowlist at the schema level)", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = VideoProps.parse(videoDefaultProps());
    expect(props.url).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  });

  it("accepts allowlisted YouTube/Vimeo URLs", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://player.vimeo.com/video/76979871",
    ]) {
      expect(VideoProps.safeParse({ url }).success, url).toBe(true);
    }
  });

  it("rejects non-allowlisted hosts", () => {
    for (const url of [
      "https://example.com/watch?v=x",
      "https://dailymotion.com/video/x",
      "https://tiktok.com/@x/video/1",
    ]) {
      expect(VideoProps.safeParse({ url }).success, url).toBe(false);
    }
  });

  it("rejects lookalike hosts — exact hostname, no suffix match", () => {
    expect(VideoProps.safeParse({ url: "https://youtube.com.evil.io/watch?v=x" }).success).toBe(false);
    expect(VideoProps.safeParse({ url: "https://vimeo.com.example.net/123" }).success).toBe(false);
    expect(VideoProps.safeParse({ url: "https://not-youtube.com/watch?v=x" }).success).toBe(false);
  });

  it("rejects dangerous schemes and relative URLs", () => {
    expect(VideoProps.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(VideoProps.safeParse({ url: "data:text/html,<script>" }).success).toBe(false);
    expect(VideoProps.safeParse({ url: "/watch?v=x" }).success).toBe(false);
  });

  it("round-trips an editor edit to another allowlisted host", () => {
    const props = VideoProps.parse(videoDefaultProps());
    const edited: unknown = { ...props, url: "https://vimeo.com/76979871" };
    expect(VideoProps.parse(edited).url).toBe("https://vimeo.com/76979871");
    // …and rejects an editor edit to a disallowed host.
    expect(VideoProps.safeParse({ ...props, url: "https://example.com/x" }).success).toBe(false);
  });
});

describe("video render", () => {
  it("renders a canonical player iframe for an allowlisted URL", () => {
    const html = renderToStaticMarkup(
      <VideoRender props={{ url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" }} />,
    );
    expect(html).toContain('data-block-kind="video"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?rel=0"');
    expect(html).not.toContain("youtube.com");
  });

  it("degrades to a link when no video id can be derived", () => {
    // Allowlisted host but unusable path (schema-valid, embed-unresolvable).
    const props = VideoProps.parse({ url: "https://vimeo.com/user123456" });
    const html = renderToStaticMarkup(<VideoRender props={props} />);
    expect(html).toContain("ff-video--fallback");
    expect(html).toContain('href="https://vimeo.com/user123456"');
  });
});
