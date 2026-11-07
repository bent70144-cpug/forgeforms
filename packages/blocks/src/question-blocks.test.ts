// T09 — question block catalog (spec §7.2): props schemas, answer schemas,
// validate, randomize (seeded) and prefillParam URL reading.
// Answer value shapes are EXACTLY the §7.2 table column:
//   email/number/long-text → string/number, single-select → {optionId} or {other},
//   multi-select → {optionIds}, dropdown → {optionId}, rating → number, nps → number 0–10.
import { describe, expect, it } from "vitest";
import {
  EmailAnswer,
  EmailProps,
  emailDefaultProps,
  prefillEmail,
  validateEmail,
} from "./email/schema";
import {
  LongTextAnswer,
  LongTextProps,
  longTextDefaultProps,
  prefillLongText,
  validateLongText,
} from "./long-text/schema";
import {
  MultiSelectAnswer,
  MultiSelectProps,
  multiSelectDefaultProps,
  prefillMultiSelect,
  validateMultiSelect,
} from "./multi-select/schema";
import {
  NpsAnswer,
  NpsProps,
  clampNps,
  npsDefaultProps,
  prefillNps,
  validateNps,
} from "./nps/schema";
import {
  NumberAnswer,
  NumberProps,
  numberDefaultProps,
  prefillNumber,
  validateNumber,
} from "./number/schema";
import {
  RatingAnswer,
  RatingIcon,
  RatingProps,
  ratingDefaultProps,
  prefillRating,
  validateRating,
} from "./rating/schema";
import {
  DropdownAnswer,
  DropdownProps,
  dropdownDefaultProps,
  prefillDropdown,
  validateDropdown,
} from "./dropdown/schema";
import {
  SingleSelectAnswer,
  SingleSelectProps,
  singleSelectDefaultProps,
  prefillSingleSelect,
  validateSingleSelect,
} from "./single-select/schema";
import { shuffledOptions } from "./shared/option-list";
import { getBlockDef } from "./registry";
import { paramsFromSearch, prefillFor } from "./shared/prefill";
import { parsePastedOptions } from "./shared/question-editor-kit";
// Importing the block modules registers them (spec §7.1 import-time registry).
import "./email";
import "./number";
import "./long-text";
import "./single-select";
import "./multi-select";
import "./dropdown";
import "./rating";
import "./nps";

const REQUIRED = "This field is required";

describe("email block (spec §7.2: label, required → string email)", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(EmailProps.parse(emailDefaultProps())).toEqual({
      label: "Email address",
      required: false,
    });
  });

  it("supports generic question props", () => {
    const props = EmailProps.parse({
      label: "Email",
      description: "We never share it",
      buttonText: "Next",
      imageAssetId: "ast_0001",
      prefillParam: "email",
      required: true,
    });
    expect(props.prefillParam).toBe("email");
  });

  it("rejects a missing label and unknown keys", () => {
    expect(EmailProps.safeParse({}).success).toBe(false);
    expect(EmailProps.safeParse({ label: "E", bogus: 1 }).success).toBe(false);
  });

  it("answerSchema accepts only email strings", () => {
    expect(EmailAnswer.safeParse("ada@example.com").success).toBe(true);
    expect(EmailAnswer.safeParse("nope").success).toBe(false);
    expect(EmailAnswer.safeParse("").success).toBe(false);
    expect(EmailAnswer.safeParse(42).success).toBe(false);
  });

  it("validate: required + format", () => {
    const base = emailDefaultProps();
    expect(validateEmail("", { ...base, required: true })).toBe(REQUIRED);
    expect(validateEmail("", base)).toBeNull();
    expect(validateEmail("nope", base)).toBe("Enter a valid email address");
    expect(validateEmail("ada@example.com", { ...base, required: true })).toBeNull();
  });

  it("prefill reads the URL param only when it is a valid email", () => {
    const props = { ...emailDefaultProps(), prefillParam: "email" as const };
    expect(prefillEmail(props, { email: "ada@example.com" })).toBe("ada@example.com");
    expect(prefillEmail(props, { email: "garbage" })).toBeUndefined();
    expect(prefillEmail(props, { other: "ada@example.com" })).toBeUndefined();
    expect(prefillEmail({ ...props, prefillParam: undefined }, { email: "ada@example.com" })).toBeUndefined();
  });
});

describe("number block (spec §7.2: label, required, min, max → number)", () => {
  const base = numberDefaultProps();

  it("parses defaultProps (registration-time proof)", () => {
    expect(NumberProps.parse(numberDefaultProps())).toEqual({ label: "Number", required: false });
  });

  it("accepts min/max props and rejects unknown keys", () => {
    expect(NumberProps.safeParse({ label: "N", min: 1, max: 10 }).success).toBe(true);
    expect(NumberProps.safeParse({ label: "N", min: "x" }).success).toBe(false);
    expect(NumberProps.safeParse({ label: "N", bogus: 1 }).success).toBe(false);
  });

  it("answerSchema accepts finite numbers only (NaN/Infinity rejected)", () => {
    expect(NumberAnswer.safeParse(42).success).toBe(true);
    expect(NumberAnswer.safeParse(-0.5).success).toBe(true);
    expect(NumberAnswer.safeParse(NaN).success).toBe(false);
    expect(NumberAnswer.safeParse(Infinity).success).toBe(false);
    expect(NumberAnswer.safeParse("42").success).toBe(false);
  });

  it("validate: required + min/max bounds", () => {
    expect(validateNumber(NaN, { ...base, required: true })).toBe(REQUIRED);
    expect(validateNumber(NaN, base)).toBeNull();
    const bounded = { ...base, min: 1, max: 10 };
    expect(validateNumber(0, bounded)).toBe("Must be at least 1");
    expect(validateNumber(11, bounded)).toBe("Must be at most 10");
    expect(validateNumber(5, bounded)).toBeNull();
    expect(validateNumber(-100, { ...base, min: -10 })).toBe("Must be at least -10");
  });

  it("prefill reads the URL param as a finite number", () => {
    const props = { ...base, prefillParam: "qty" as const };
    expect(prefillNumber(props, { qty: "42" })).toBe(42);
    expect(prefillNumber(props, { qty: "abc" })).toBeUndefined();
    expect(prefillNumber(props, {})).toBeUndefined();
  });
});

describe("long-text block (spec §7.2: label, placeholder, required, maxLength → string)", () => {
  const base = longTextDefaultProps();

  it("parses defaultProps (registration-time proof)", () => {
    expect(LongTextProps.parse(longTextDefaultProps())).toEqual({
      label: "Long answer",
      placeholder: "",
      required: false,
    });
  });

  it("answerSchema accepts strings", () => {
    expect(LongTextAnswer.safeParse("story").success).toBe(true);
    expect(LongTextAnswer.safeParse("").success).toBe(true);
    expect(LongTextAnswer.safeParse(7).success).toBe(false);
  });

  it("validate: required + maxLength", () => {
    expect(validateLongText("", { ...base, required: true })).toBe(REQUIRED);
    expect(validateLongText("abcdef", { ...base, maxLength: 5 })).toBe(
      "Must be at most 5 characters",
    );
    expect(validateLongText("abc", { ...base, required: true, maxLength: 5 })).toBeNull();
  });

  it("prefill reads the URL param as text", () => {
    const props = { ...base, prefillParam: "bio" as const };
    expect(prefillLongText(props, { bio: "hello" })).toBe("hello");
    expect(prefillLongText(props, { bio: "" })).toBeUndefined();
    expect(prefillLongText(props, {})).toBeUndefined();
  });
});

describe("single-select block (§7.2: options, allowOther, randomize → {optionId} or {other})", () => {
  const base = singleSelectDefaultProps();
  const firstId = base.options[0]?.id ?? "";

  it("parses defaultProps with allowOther/randomize/displayMode defaults", () => {
    const props = SingleSelectProps.parse(singleSelectDefaultProps());
    expect(props.allowOther).toBe(false);
    expect(props.randomize).toBe(false);
    expect(props.displayMode).toBe("list");
    expect(props.options).toHaveLength(2);
  });

  it("§9.2 displayMode: old docs parse unchanged and get the list default", () => {
    // An old stored document carries no displayMode key at all.
    const legacy: unknown = { label: "L", options: base.options, allowOther: true };
    const parsed = SingleSelectProps.parse(legacy);
    expect(parsed.displayMode).toBe("list");
    expect(parsed.allowOther).toBe(true);
    // New docs can opt into grid/picture; anything else is rejected.
    expect(SingleSelectProps.safeParse({ ...base, displayMode: "grid" }).success).toBe(true);
    expect(SingleSelectProps.safeParse({ ...base, displayMode: "picture" }).success).toBe(true);
    expect(SingleSelectProps.safeParse({ ...base, displayMode: "carousel" }).success).toBe(false);
  });

  it("rejects an option without id/label and empty option lists", () => {
    expect(
      SingleSelectProps.safeParse({ label: "L", options: [{ id: "", label: "A" }] }).success,
    ).toBe(false);
    expect(SingleSelectProps.safeParse({ label: "L", options: [] }).success).toBe(false);
    expect(
      SingleSelectProps.safeParse({ label: "L", options: [{ id: "a", label: "" }] }).success,
    ).toBe(false);
  });

  it("answerSchema accepts exactly {optionId} or {other}", () => {
    expect(SingleSelectAnswer.safeParse({ optionId: firstId }).success).toBe(true);
    expect(SingleSelectAnswer.safeParse({ other: "custom" }).success).toBe(true);
    // {other} strips a stray optionId like the ingest bootstrap registry does.
    expect(SingleSelectAnswer.safeParse({ optionId: "", other: "custom" })).toEqual({
      success: true,
      data: { other: "custom" },
    });
    expect(SingleSelectAnswer.safeParse({ optionId: "" }).success).toBe(false);
    expect(SingleSelectAnswer.safeParse({}).success).toBe(false);
    expect(SingleSelectAnswer.safeParse(firstId).success).toBe(false);
    expect(SingleSelectAnswer.safeParse({ optionId: 42 }).success).toBe(false);
  });

  it("validate: a known optionId passes; unknown fails", () => {
    expect(validateSingleSelect({ optionId: firstId }, base)).toBeNull();
    expect(validateSingleSelect({ optionId: "opt_missing" }, base)).toBe("Unknown option");
  });

  it("validate: allowOther gates {other} answers", () => {
    expect(validateSingleSelect({ other: "custom" }, base)).toBe("Custom answers are not allowed");
    const allowing = { ...base, allowOther: true };
    expect(validateSingleSelect({ other: "custom" }, allowing)).toBeNull();
    expect(validateSingleSelect({ other: "   " }, { ...allowing, required: true })).toBe(REQUIRED);
    expect(validateSingleSelect({ other: "   " }, allowing)).toBeNull();
  });

  it("validate: empty answer honors required", () => {
    // Raw (unparsed) empty object — the client mirror can call validate directly.
    expect(validateSingleSelect({} as SingleSelectAnswer, { ...base, required: true })).toBe(REQUIRED);
    expect(validateSingleSelect({} as SingleSelectAnswer, base)).toBeNull();
  });

  it("prefill: option id, then option label, then {other} when allowed", () => {
    const props = { ...base, prefillParam: "pick" as const };
    expect(prefillSingleSelect(props, { pick: firstId })).toEqual({ optionId: firstId });
    expect(prefillSingleSelect(props, { pick: "Option 1" })).toEqual({ optionId: firstId });
    expect(prefillSingleSelect(props, { pick: "nope" })).toBeUndefined();
    expect(prefillSingleSelect({ ...props, allowOther: true }, { pick: "nope" })).toEqual({
      other: "nope",
    });
    expect(prefillSingleSelect({ ...props, allowOther: true }, { pick: "" })).toBeUndefined();
  });
});

describe("single-select randomize (seeded, deterministic)", () => {
  const options = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];

  it("keeps the same multiset and produces a deterministic permutation for a fixed rng", () => {
    const zero = (): number => 0;
    // rng always 0 → Fisher-Yates j=0: [a,b,c] → swap(2,0) → [c,b,a] → swap(1,0) → [b,c,a]
    expect(shuffledOptions(options, zero)).toEqual([
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "a", label: "A" },
    ]);
  });

  it("same seed → same order; different seed → different order (mulberry32)", () => {
    const mulberry32 = (seed: number): (() => number) => {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const run1 = shuffledOptions(options, mulberry32(42));
    const run2 = shuffledOptions(options, mulberry32(42));
    const run3 = shuffledOptions(options, mulberry32(1337));
    expect(run1).toEqual(run2);
    expect(run3).not.toEqual(run1);
    // A shuffle is a permutation: same elements, different order.
    expect([...run1].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      [...options].sort((x, y) => x.id.localeCompare(y.id)),
    );
    expect(run1).not.toEqual(options);
  });

  it("does not mutate the input array", () => {
    const copy = [...options];
    shuffledOptions(options, () => 0.99);
    expect(options).toEqual(copy);
  });
});

describe("multi-select block (§7.2: options, min, max → {optionIds})", () => {
  const base = multiSelectDefaultProps();
  const [id1, id2] = [base.options[0]?.id ?? "", base.options[1]?.id ?? ""];

  it("parses defaultProps (registration-time proof)", () => {
    const props = MultiSelectProps.parse(multiSelectDefaultProps());
    expect(props.min).toBeUndefined();
    expect(props.max).toBeUndefined();
  });

  it("accepts min/max and rejects negative or non-integer bounds", () => {
    expect(MultiSelectProps.safeParse({ label: "L", options: base.options, min: 1, max: 2 }).success).toBe(true);
    expect(MultiSelectProps.safeParse({ label: "L", options: base.options, min: -1 }).success).toBe(false);
    expect(MultiSelectProps.safeParse({ label: "L", options: base.options, max: 1.5 }).success).toBe(false);
  });

  it("answerSchema accepts exactly {optionIds: string[]}", () => {
    expect(MultiSelectAnswer.safeParse({ optionIds: [id1, id2] }).success).toBe(true);
    expect(MultiSelectAnswer.safeParse({ optionIds: [] }).success).toBe(true);
    expect(MultiSelectAnswer.safeParse({ optionIds: [id1] }).success).toBe(true);
    expect(MultiSelectAnswer.safeParse([id1]).success).toBe(false);
    expect(MultiSelectAnswer.safeParse({ optionIds: "x" }).success).toBe(false);
    expect(MultiSelectAnswer.safeParse({ optionIds: [42] }).success).toBe(false);
    expect(MultiSelectAnswer.safeParse({}).success).toBe(false);
  });

  it("validate honors min and max", () => {
    const props = { ...base, min: 1, max: 2 };
    expect(validateMultiSelect({ optionIds: [] }, props)).toBe("Select at least 1");
    // Three KNOWN options to exercise the max bound (unknown ids fail earlier).
    const withThird = {
      ...props,
      options: [...props.options, { id: "opt_0003", label: "Option 3" }],
    };
    expect(validateMultiSelect({ optionIds: [id1, id2, "opt_0003"] }, withThird)).toBe(
      "Select at most 2",
    );
    expect(validateMultiSelect({ optionIds: [id1] }, props)).toBeNull();
    expect(validateMultiSelect({ optionIds: [id1, id2] }, props)).toBeNull();
  });

  it("validate rejects unknown options and empty answers when required", () => {
    expect(validateMultiSelect({ optionIds: [id1, "opt_missing"] }, base)).toBe("Unknown option");
    expect(validateMultiSelect({ optionIds: [] }, { ...base, required: true })).toBe(REQUIRED);
    expect(validateMultiSelect({ optionIds: [] }, base)).toBeNull();
  });

  it("prefill: comma-separated param matches ids/labels", () => {
    const props = { ...base, prefillParam: "tags" as const };
    expect(prefillMultiSelect(props, { tags: `${id1},Option 2` })).toEqual({ optionIds: [id1, id2] });
    expect(prefillMultiSelect(props, { tags: `${id1},${id1}` })).toEqual({ optionIds: [id1] });
    expect(prefillMultiSelect(props, { tags: "nope" })).toBeUndefined();
    expect(prefillMultiSelect(props, {})).toBeUndefined();
  });
});

describe("dropdown block (§7.2: options, searchable → {optionId})", () => {
  const base = dropdownDefaultProps();
  const firstId = base.options[0]?.id ?? "";

  it("parses defaultProps with searchable default false", () => {
    expect(DropdownProps.parse(dropdownDefaultProps()).searchable).toBe(false);
    expect(DropdownProps.parse({ label: "L", options: base.options, searchable: true }).searchable).toBe(true);
  });

  it("answerSchema accepts exactly {optionId}", () => {
    expect(DropdownAnswer.safeParse({ optionId: firstId }).success).toBe(true);
    expect(DropdownAnswer.safeParse({ optionId: "" }).success).toBe(false);
    expect(DropdownAnswer.safeParse({ other: "x" }).success).toBe(false);
    expect(DropdownAnswer.safeParse({}).success).toBe(false);
  });

  it("validate: known option only", () => {
    expect(validateDropdown({ optionId: firstId }, base)).toBeNull();
    expect(validateDropdown({ optionId: "opt_missing" }, base)).toBe("Unknown option");
    expect(validateDropdown({} as DropdownAnswer, { ...base, required: true })).toBe(REQUIRED);
    expect(validateDropdown({} as DropdownAnswer, base)).toBeNull();
  });

  it("prefill: option id or label only (no {other})", () => {
    const props = { ...base, prefillParam: "choice" as const };
    expect(prefillDropdown(props, { choice: firstId })).toEqual({ optionId: firstId });
    expect(prefillDropdown(props, { choice: "Option 1" })).toEqual({ optionId: firstId });
    expect(prefillDropdown(props, { choice: "nope" })).toBeUndefined();
  });
});

describe("§9.2 dropdown bulk-paste (parsePastedOptions)", () => {
  const base = dropdownDefaultProps();

  it("splits lines, trims, drops blanks, and mints stable ids", () => {
    const merged = parsePastedOptions("  Red  \n\nGreen\nBlue\n", []);
    expect(merged.map((option) => option.label)).toEqual(["Red", "Green", "Blue"]);
    expect(new Set(merged.map((option) => option.id)).size).toBe(3);
    expect(merged.every((option) => option.id.startsWith("opt_"))).toBe(true);
  });

  it("merges into existing options and dedupes exact labels", () => {
    const merged = parsePastedOptions("Option 1\nTeal\nTeal\n", base.options);
    expect(merged.map((option) => option.label)).toEqual(["Option 1", "Option 2", "Teal"]);
    expect(DropdownProps.parse({ ...base, options: merged }).options).toHaveLength(3);
  });

  it("caps the merged list at the shared 200-option limit", () => {
    const existing = base.options;
    const pasted = Array.from({ length: 210 }, (_, i) => `Choice ${i + 1}`).join("\n");
    const merged = parsePastedOptions(pasted, existing);
    expect(merged).toHaveLength(200); // OptionList max(200)
    expect(() => DropdownProps.parse({ ...base, options: merged })).not.toThrow();
  });

  it("a paste that yields nothing keeps the current options untouched", () => {
    expect(parsePastedOptions("\n  \n", base.options)).toEqual(base.options);
    expect(parsePastedOptions("Option 1\n", base.options)).toEqual(base.options);
  });
});

describe("rating block (§7.2: scale 3–10, icon → number)", () => {
  const base = ratingDefaultProps();

  it("parses defaultProps with scale/icon defaults", () => {
    expect(RatingProps.parse(ratingDefaultProps())).toEqual({
      label: "Rating",
      scale: 5,
      icon: "star",
      required: false,
    });
  });

  it("scale honors the 3–10 bounds; icon is a fixed enum incl. §9.2 'number'", () => {
    expect(RatingProps.safeParse({ label: "L", scale: 3 }).success).toBe(true);
    expect(RatingProps.safeParse({ label: "L", scale: 10 }).success).toBe(true);
    expect(RatingProps.safeParse({ label: "L", scale: 2 }).success).toBe(false);
    expect(RatingProps.safeParse({ label: "L", scale: 11 }).success).toBe(false);
    expect(RatingProps.safeParse({ label: "L", scale: 5.5 }).success).toBe(false);
    expect(RatingIcon.options).toEqual(["star", "heart", "thumbs", "number"]);
    expect(RatingProps.safeParse({ label: "L", icon: "coin" }).success).toBe(false);
  });

  it("§9.2 icon 'number' parses and older icons keep their glyph meaning", () => {
    expect(RatingProps.parse({ ...base, icon: "number" }).icon).toBe("number");
    expect(RatingProps.parse({ label: "L", icon: "thumbs" }).icon).toBe("thumbs");
  });

  it("answerSchema accepts integers only", () => {
    expect(RatingAnswer.safeParse(4).success).toBe(true);
    expect(RatingAnswer.safeParse(4.5).success).toBe(false);
    expect(RatingAnswer.safeParse("4").success).toBe(false);
  });

  it("validate honors scale bounds (1..scale)", () => {
    const scale3 = { ...base, scale: 3 as const };
    expect(validateRating(0, scale3)).toBe("Must be between 1 and 3");
    expect(validateRating(4, scale3)).toBe("Must be between 1 and 3");
    expect(validateRating(3, scale3)).toBeNull();
    expect(validateRating(1, scale3)).toBeNull();
    const scale10 = { ...base, scale: 10 as const };
    expect(validateRating(10, scale10)).toBeNull();
    expect(validateRating(11, scale10)).toBe("Must be between 1 and 10");
    expect(validateRating(NaN, { ...scale10, required: true })).toBe(REQUIRED);
  });

  it("prefill reads the URL param and clamps into 1..scale", () => {
    const props = { ...base, scale: 3 as const, prefillParam: "r" as const };
    expect(prefillRating(props, { r: "2" })).toBe(2);
    expect(prefillRating(props, { r: "99" })).toBe(3);
    expect(prefillRating(props, { r: "0" })).toBe(1);
    expect(prefillRating(props, { r: "x" })).toBeUndefined();
  });
});

describe("nps block (§7.2: label, leftLabel, rightLabel → number 0–10)", () => {
  const base = npsDefaultProps();

  it("parses defaultProps with left/right labels", () => {
    expect(NpsProps.parse(npsDefaultProps())).toEqual({
      label: "How likely are you to recommend us?",
      leftLabel: "Not likely",
      rightLabel: "Very likely",
      required: false,
    });
  });

  it("answerSchema accepts integers 0–10 only", () => {
    expect(NpsAnswer.safeParse(0).success).toBe(true);
    expect(NpsAnswer.safeParse(10).success).toBe(true);
    expect(NpsAnswer.safeParse(-1).success).toBe(false);
    expect(NpsAnswer.safeParse(11).success).toBe(false);
    expect(NpsAnswer.safeParse(2.5).success).toBe(false);
    expect(NpsAnswer.safeParse("5").success).toBe(false);
  });

  it("validate enforces the 0–10 range", () => {
    expect(validateNps(0, base)).toBeNull();
    expect(validateNps(10, base)).toBeNull();
    expect(validateNps(-1, base)).toBe("Must be between 0 and 10");
    expect(validateNps(11, base)).toBe("Must be between 0 and 10");
    expect(validateNps(2.5, base)).toBe("Must be between 0 and 10");
    expect(validateNps(NaN, { ...base, required: true })).toBe(REQUIRED);
  });

  it("clampNps clamps any number into 0–10 (acceptance: nps clamps 0–10)", () => {
    expect(clampNps(-5)).toBe(0);
    expect(clampNps(15)).toBe(10);
    expect(clampNps(4.6)).toBe(5);
    expect(clampNps(7)).toBe(7);
    expect(clampNps(NaN)).toBe(0);
    expect(clampNps(Infinity)).toBe(10);
  });

  it("prefill reads the URL param and clamps 0–10", () => {
    const props = { ...base, prefillParam: "score" as const };
    expect(prefillNps(props, { score: "7" })).toBe(7);
    expect(prefillNps(props, { score: "99" })).toBe(10);
    expect(prefillNps(props, { score: "-3" })).toBe(0);
    expect(prefillNps(props, { score: "x" })).toBeUndefined();
  });
});

describe("question blocks are registered (palette category: family 'question')", () => {
  const kinds = [
    "email",
    "number",
    "long-text",
    "single-select",
    "multi-select",
    "dropdown",
    "rating",
    "nps",
  ] as const;

  it("registers all 8 MVP question kinds", () => {
    for (const kind of kinds) {
      const def = getBlockDef(kind);
      expect(def, kind).toBeDefined();
      expect(def?.family, kind).toBe("question");
      expect(def?.answerSchema, kind).toBeDefined();
      expect(typeof def?.validate).toBe("function");
    }
  });
});

describe("paramsFromSearch + prefillFor dispatcher", () => {
  it("parses URLSearchParams and query strings", () => {
    expect(paramsFromSearch(new URLSearchParams("a=1&b=x"))).toEqual({ a: "1", b: "x" });
    expect(paramsFromSearch("?a=1&b=x")).toEqual({ a: "1", b: "x" });
    expect(paramsFromSearch(null)).toEqual({});
    expect(paramsFromSearch(undefined)).toEqual({});
  });

  it("prefillFor dispatches by kind with parsed props", () => {
    const rating = ratingDefaultProps();
    expect(prefillFor("rating", { ...rating, scale: 3, prefillParam: "r" }, { r: "99" })).toBe(3);
    expect(prefillFor("nps", { ...npsDefaultProps(), prefillParam: "s" }, { s: "-2" })).toBe(0);
    expect(prefillFor("email", { ...emailDefaultProps(), prefillParam: "e" }, { e: "nope" })).toBeUndefined();
    expect(prefillFor("short-text", { label: "L", prefillParam: "q" }, { q: "x" })).toBeUndefined();
    expect(prefillFor("marquee", {}, { q: "x" })).toBeUndefined();
    expect(prefillFor("rating", { bogus: true }, { r: "3" })).toBeUndefined();
  });
});
