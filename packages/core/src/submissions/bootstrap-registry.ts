// packages/core/src/submissions/bootstrap-registry.ts
// INTEGRATION-DEBT: awaiting T04/T05 (@formforge/blocks registry with
// answerSchema + validate per block kind). Until it lands, this registry
// implements the MVP question catalog of spec §7.2 exactly (answer shapes are
// pinned there), plus the layout/content kinds the walker must recurse into.
// apps/web wiring should swap to the real registry once available.

import { z } from "zod";
import type { BlockInfo, BlockRegistry } from "./types";

function optionIds(props: Record<string, unknown>): string[] {
  const options = Array.isArray(props.options) ? props.options : [];
  return options
    .map((option) =>
      option && typeof option === "object" && "id" in option
        ? String((option as { id: unknown }).id)
        : "",
    )
    .filter((id) => id !== "");
}

function numProp(props: Record<string, unknown>, key: string): number | null {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const choiceAnswer = z.union([
  z.object({ optionId: z.string().min(1) }),
  z.object({ other: z.string() }),
]);

const multiSelectAnswer = z.object({ optionIds: z.array(z.string()) });

const dropdownAnswer = z.object({ optionId: z.string().min(1) });

const fileUploadAnswer = z.object({ assetIds: z.array(z.string()) });

const question = (
  kind: string,
  extra: Pick<BlockInfo, "answerSchema" | "validate"> = {},
): BlockInfo => ({ kind, family: "question", ...extra });

const layout = (kind: string): BlockInfo => ({ kind, family: "layout" });
const content = (kind: string): BlockInfo => ({ kind, family: "content" });
const action = (kind: string): BlockInfo => ({ kind, family: "action" });

/** MVP registry per spec §7.2. */
export function createBootstrapBlockRegistry(): BlockRegistry {
  const defs: Record<string, BlockInfo> = {
    // Question blocks (answer shapes pinned by §7.2)
    "short-text": question("short-text", {
      answerSchema: z.string(),
      validate: (answer, props) => {
        const maxLength = numProp(props, "maxLength");
        if (maxLength != null && String(answer).length > maxLength) {
          return `Must be at most ${maxLength} characters`;
        }
        return null;
      },
    }),
    "long-text": question("long-text", {
      answerSchema: z.string(),
      validate: (answer, props) => {
        const maxLength = numProp(props, "maxLength");
        if (maxLength != null && String(answer).length > maxLength) {
          return `Must be at most ${maxLength} characters`;
        }
        return null;
      },
    }),
    email: question("email", { answerSchema: z.email() }),
    number: question("number", {
      answerSchema: z.number(),
      validate: (answer, props) => {
        const value = typeof answer === "number" ? answer : Number(answer);
        const min = numProp(props, "min");
        const max = numProp(props, "max");
        if (min != null && value < min) return `Must be at least ${min}`;
        if (max != null && value > max) return `Must be at most ${max}`;
        return null;
      },
    }),
    "single-select": question("single-select", {
      answerSchema: choiceAnswer,
      validate: (answer, props) => {
        const value = answer as { optionId?: unknown; other?: unknown };
        if (typeof value.other === "string") {
          return props.allowOther === true ? null : "Custom answers are not allowed";
        }
        if (typeof value.optionId === "string") {
          return optionIds(props).includes(value.optionId) ? null : "Unknown option";
        }
        return "Invalid answer";
      },
    }),
    "multi-select": question("multi-select", {
      answerSchema: multiSelectAnswer,
      validate: (answer, props) => {
        const ids = (answer as { optionIds: string[] }).optionIds;
        const known = optionIds(props);
        if (ids.some((id) => !known.includes(id))) return "Unknown option";
        const min = numProp(props, "min");
        const max = numProp(props, "max");
        if (min != null && ids.length < min) return `Select at least ${min}`;
        if (max != null && ids.length > max) return `Select at most ${max}`;
        return null;
      },
    }),
    dropdown: question("dropdown", {
      answerSchema: dropdownAnswer,
      validate: (answer, props) => {
        const id = (answer as { optionId: string }).optionId;
        return optionIds(props).includes(id) ? null : "Unknown option";
      },
    }),
    rating: question("rating", {
      answerSchema: z.number().int(),
      validate: (answer, props) => {
        const scale = numProp(props, "scale") ?? 5;
        const value = typeof answer === "number" ? answer : Number(answer);
        if (value < 1 || value > scale) return `Must be between 1 and ${scale}`;
        return null;
      },
    }),
    nps: question("nps", { answerSchema: z.number().int().min(0).max(10) }),
    "file-upload": question("file-upload", { answerSchema: fileUploadAnswer }),

    // Layout blocks (walker recurses into children)
    section: layout("section"),
    columns: layout("columns"),
    "multi-question-page": layout("multi-question-page"),

    // Content/action blocks (never store answers)
    hero: content("hero"),
    text: content("text"),
    image: content("image"),
    gallery: content("gallery"),
    video: content("video"),
    testimonials: content("testimonials"),
    faq: content("faq"),
    pricing: content("pricing"),
    projects: content("projects"),
    "contact-links": content("contact-links"),
    button: action("button"),
    "form-embed": action("form-embed"),
  };

  return {
    get(kind: string): BlockInfo | undefined {
      return defs[kind];
    },
  };
}
