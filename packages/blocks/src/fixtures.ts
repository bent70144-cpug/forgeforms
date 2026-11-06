// Shared fixtures for blocks tests. NOT a test file (no *.test.* name).
import { DocumentBody, type Block } from "@formforge/schema";
import { buttonDefaultProps } from "./button/schema";
import { dropdownDefaultProps } from "./dropdown/schema";
import { emailDefaultProps } from "./email/schema";
import { heroDefaultProps } from "./hero/schema";
import { longTextDefaultProps } from "./long-text/schema";
import { multiSelectDefaultProps } from "./multi-select/schema";
import { npsDefaultProps } from "./nps/schema";
import { numberDefaultProps } from "./number/schema";
import { ratingDefaultProps } from "./rating/schema";
import { shortTextDefaultProps } from "./short-text/schema";
import { singleSelectDefaultProps } from "./single-select/schema";

export const heroId = "blk_hero001";
export const shortTextId = "blk_text0001";
export const buttonId = "blk_button01";

export function heroBlockFixture(): Block {
  return {
    id: heroId,
    kind: "hero",
    props: { title: "Ship forms faster", subtitle: "One model, three products." },
  };
}

export function shortTextBlockFixture(): Block {
  return {
    id: shortTextId,
    kind: "short-text",
    props: { label: "Your name", placeholder: "Ada Lovelace", required: true, maxLength: 80 },
  };
}

export function buttonBlockFixture(): Block {
  return { id: buttonId, kind: "button", props: { label: "Submit", href: "/thanks", style: "primary" } };
}

export function validDocumentBodyFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "form",
    theme: { tokens: {} },
    settings: {},
    blocks: [heroBlockFixture(), shortTextBlockFixture(), buttonBlockFixture()],
  };
}

export function parsedValidDocumentBodyFixture() {
  return DocumentBody.parse(validDocumentBodyFixture());
}

export const defaultPropSets = {
  hero: heroDefaultProps,
  "short-text": shortTextDefaultProps,
  button: buttonDefaultProps,
  // T09 question kinds (§7.2)
  email: emailDefaultProps,
  number: numberDefaultProps,
  "long-text": longTextDefaultProps,
  "single-select": singleSelectDefaultProps,
  "multi-select": multiSelectDefaultProps,
  dropdown: dropdownDefaultProps,
  rating: ratingDefaultProps,
  nps: npsDefaultProps,
} as const;
