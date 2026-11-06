// Shared fixtures for schema tests. NOT a test file (no *.test.* name).
import { DocumentBody } from "./document";

export const heroBlockFixture = {
  id: "blk_hero001",
  kind: "hero",
  props: {
    title: "Ship forms faster",
    subtitle: "One block model for forms, pages and portfolios.",
    cta: { label: "Get started", href: "/signup" },
  },
};

export const shortTextBlockFixture = {
  id: "blk_text0001",
  kind: "short-text",
  props: {
    label: "Your name",
    placeholder: "Ada Lovelace",
    required: true,
    maxLength: 80,
  },
};

export const buttonBlockFixture = {
  id: "blk_button01",
  kind: "button",
  props: { label: "Submit", href: "/thanks", style: "primary" },
};

export function validDocumentBodyFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "form",
    theme: { tokens: { "color.bg": "#fbf9f4" } },
    settings: {},
    blocks: [heroBlockFixture, shortTextBlockFixture, buttonBlockFixture],
  };
}

export function parsedValidDocumentBodyFixture(): DocumentBody {
  return DocumentBody.parse(validDocumentBodyFixture());
}
