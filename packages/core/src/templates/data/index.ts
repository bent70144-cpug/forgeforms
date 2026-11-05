// Seed-template registry: the single source of truth for the gallery (issue #22).
// Order here is the order the marketing gallery renders.
import type { TemplateDefinition } from "../types";
import { formTemplates } from "./forms";
import { pageTemplates } from "./pages";
import { portfolioTemplates } from "./portfolios";

export const templateRegistry: readonly TemplateDefinition[] = Object.freeze([
  ...formTemplates,
  ...pageTemplates,
  ...portfolioTemplates,
]);
