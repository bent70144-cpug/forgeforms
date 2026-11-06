// packages/blocks — prefillParam runtime (spec §7.2 generic question props:
// "prefillParam (URL param name)"). Pure and isomorphic: given URL params, a
// question block's props produce that block's answer value; nothing here
// touches `window`, so it is server-safe. OWNED BY T09 (issue #9).
//
// Coercion is strict: a prefill that does not parse as the block's answer
// (unknown option id/label, non-numeric number, out-of-range rating/nps) is
// dropped rather than stored — garbage URL params never become answers, and
// rating/nps prefills clamp into their bounds.
import { prefillDropdown, DropdownProps } from "../dropdown/schema";
import { prefillEmail, EmailProps } from "../email/schema";
import { prefillLongText, LongTextProps } from "../long-text/schema";
import { prefillMultiSelect, MultiSelectProps } from "../multi-select/schema";
import { prefillNps, NpsProps } from "../nps/schema";
import { prefillNumber, NumberProps } from "../number/schema";
import { prefillRating, RatingProps } from "../rating/schema";
import { prefillSingleSelect, SingleSelectProps } from "../single-select/schema";

/** URL params as a plain record (e.g. `Object.fromEntries(new URL(url).searchParams)`). */
export type UrlParams = Readonly<Record<string, string>> | null | undefined;

/** Read the raw prefill value for a question's `prefillParam`; null when unset. */
export function rawParam(params: UrlParams, prefillParam: string | undefined): string | null {
  if (!prefillParam || !params) return null;
  const value = params[prefillParam];
  return typeof value === "string" && value !== "" ? value : null;
}

/** `URLSearchParams` / query string / URL → plain record. Never throws. */
export function paramsFromSearch(
  search: string | URLSearchParams | null | undefined,
): Record<string, string> {
  if (!search) return {};
  try {
    const sp = search instanceof URLSearchParams ? search : new URLSearchParams(search);
    return Object.fromEntries(sp.entries());
  } catch {
    return {};
  }
}

/**
 * Prefill answer for any question kind registered by T09. Props are parsed
 * through the kind's schema first, so malformed props yield no prefill (the
 * renderer would refuse to render them anyway). Kinds outside this module
 * (e.g. short-text) intentionally yield undefined here.
 */
export function prefillFor(kind: string, props: unknown, params: UrlParams): unknown {
  switch (kind) {
    case "email": {
      const parsed = EmailProps.safeParse(props);
      return parsed.success ? prefillEmail(parsed.data, params) : undefined;
    }
    case "number": {
      const parsed = NumberProps.safeParse(props);
      return parsed.success ? prefillNumber(parsed.data, params) : undefined;
    }
    case "long-text": {
      const parsed = LongTextProps.safeParse(props);
      return parsed.success ? prefillLongText(parsed.data, params) : undefined;
    }
    case "single-select": {
      const parsed = SingleSelectProps.safeParse(props);
      return parsed.success ? prefillSingleSelect(parsed.data, params) : undefined;
    }
    case "multi-select": {
      const parsed = MultiSelectProps.safeParse(props);
      return parsed.success ? prefillMultiSelect(parsed.data, params) : undefined;
    }
    case "dropdown": {
      const parsed = DropdownProps.safeParse(props);
      return parsed.success ? prefillDropdown(parsed.data, params) : undefined;
    }
    case "rating": {
      const parsed = RatingProps.safeParse(props);
      return parsed.success ? prefillRating(parsed.data, params) : undefined;
    }
    case "nps": {
      const parsed = NpsProps.safeParse(props);
      return parsed.success ? prefillNps(parsed.data, params) : undefined;
    }
    default:
      return undefined;
  }
}
