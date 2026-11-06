// packages/blocks — `projects` props schema (spec §7.2: items[{title,
// description, coverAssetId, link, tags[]}]). Portfolio content block.
// Cover references flow through the T16 adapter seam (shared/img).
// OWNED BY T21 (issue #21).
import { z } from "zod";
import { ImageAssetRefSchema } from "../shared/img";

export const ProjectItem = z.strictObject({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).default(""),
  coverAssetId: ImageAssetRefSchema.optional(),
  // Relative URLs are allowed (e.g. "/work/x"); scheme checked at render.
  link: z.string().min(1).max(2048).optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).default([]),
});

export const ProjectsProps = z.strictObject({
  items: z
    .array(ProjectItem)
    .max(50)
    .default([{ title: "Project one", description: "A short case study.", tags: ["design"] }]),
});

export type ProjectItem = z.infer<typeof ProjectItem>;
export type ProjectsProps = z.infer<typeof ProjectsProps>;

export const projectsDefaultProps = (): ProjectsProps => ({
  items: [{ title: "Project one", description: "A short case study.", tags: ["design"] }],
});
