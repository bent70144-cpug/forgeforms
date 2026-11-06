// T21 — `projects` schema + render (spec §7.2: items[{title,description,
// coverAssetId,link,tags[]}]).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectsProps, projectsDefaultProps } from "./schema";
import { ProjectsRender } from "./render";

const SAMPLE = {
  title: "Redesign 2024",
  description: "Marketing site overhaul.",
  coverAssetId: "ast_0001",
  link: "https://example.com/work",
  tags: ["web", "brand"],
};

describe("projects props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = ProjectsProps.parse(projectsDefaultProps());
    expect(props.items[0]?.title).toBe("Project one");
    expect(props.items[0]?.tags).toEqual(["design"]);
  });

  it("fills description and tags defaults", () => {
    const props = ProjectsProps.parse({ items: [{ title: "Solo" }] });
    expect(props.items[0]?.description).toBe("");
    expect(props.items[0]?.tags).toEqual([]);
  });

  it("accepts cover refs through the T16 adapter seam (string or resolved)", () => {
    expect(ProjectsProps.safeParse({ items: [{ title: "T", coverAssetId: "ast_0001" }] }).success).toBe(true);
    expect(
      ProjectsProps.safeParse({ items: [{ title: "T", coverAssetId: { src: "https://cdn.example.com/c.jpg", srcSet: "c 2x" } }] })
        .success,
    ).toBe(true);
  });

  it("rejects more than 10 tags per project", () => {
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(ProjectsProps.safeParse({ items: [{ title: "T", tags }] }).success).toBe(false);
  });

  it("round-trips an editor edit (edit tags)", () => {
    const props = ProjectsProps.parse(projectsDefaultProps());
    const edited: unknown = { items: [{ ...props.items[0]!, tags: ["design", "motion"] }] };
    expect(ProjectsProps.parse(edited).items[0]?.tags).toEqual(["design", "motion"]);
  });
});

describe("projects render", () => {
  it("renders cover, title, description, tags and a safe link", () => {
    const html = renderToStaticMarkup(<ProjectsRender props={{ items: [SAMPLE] }} />);
    expect(html).toContain('data-block-kind="projects"');
    expect(html).toContain('src="ast_0001"');
    expect(html).toContain("Redesign 2024");
    expect(html).toContain("Marketing site overhaul.");
    expect(html).toContain("web");
    expect(html).toContain('href="https://example.com/work"');
  });

  it("renders an unlinked card when no link is set", () => {
    const html = renderToStaticMarkup(<ProjectsRender props={{ items: [{ title: "T", description: "", tags: [] }] }} />);
    expect(html).toContain("ff-projects__card");
    expect(html).not.toContain("ff-projects__card--linked");
  });

  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<ProjectsRender props={{ items: [] }} />)).toBe("");
  });
});
