// packages/blocks — `projects` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { ProjectsEditor } from "./editor";
import { ProjectsRender } from "./render";
import { ProjectsProps, projectsDefaultProps } from "./schema";

export const projectsBlock: BlockDef<ProjectsProps> = {
  kind: "projects",
  family: "content",
  label: "Projects",
  icon: "folder-kanban",
  propsSchema: ProjectsProps,
  defaultProps: projectsDefaultProps,
  Editor: ProjectsEditor,
  Render: ProjectsRender,
};

registerBlock(projectsBlock);
