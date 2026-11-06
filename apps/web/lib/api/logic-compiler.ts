// T20 — LogicCompiler adapter wiring T13's logic engine into the publish
// pipeline (spec §8 step 1 "lint rules" + §9 "compile-time lint blocks
// publish").
//
// T13's `compile()` embeds lint diagnostics (dangling goto, unknown scope,
// multiple fallbacks, cycles, …) each carrying `ruleId`/`blockId`. This
// adapter projects error-severity diagnostics into the T10 port's
// `DraftValidationIssue` shape, composing the RULE ID into the message so a
// blocked publish names the offending rule (ticket #20 acceptance:
// "Dangling goto target blocks publish with clear error naming the rule").
//
// The engine import is `@formforge/core/logic` — the same single package
// surface the builder canvas and the ingest runtime use (spec §15 M5).
// T13's engine file(s) are consumed unchanged.

import { compile as engineCompile, routeMap as engineRouteMap } from "@formforge/core/logic";
import type { Diagnostic } from "@formforge/core/logic";
import type { DraftValidationIssue, LogicCompiler } from "@formforge/core";

/**
 * Builds the publish-pipeline LogicCompiler over T13's engine.
 *
 * `endings` (optional per the T10 port): ending ids from the draft body, so
 * `end:<id>` goto targets are verified against the document's endings. When
 * the caller cannot supply them, T13 accepts any `end:*` target (cannot
 * verify) — block-target dangles are still caught.
 */
export function makeT13LogicCompiler(): LogicCompiler {
  return {
    compile(rules, blocks, endings) {
      // Port inputs are `unknown`-typed by design (T10 structural); the
      // engine validates malformed entries into diagnostics, never throws.
      const routing = engineCompile(
        rules as Parameters<typeof engineCompile>[0],
        blocks as Parameters<typeof engineCompile>[1],
        endings ?? [],
      );
      const issues = routing.diagnostics
        .filter((d) => d.severity === "error")
        .map(toIssue);
      return { routing: engineRouteMap(routing), issues };
    },
  };
}

/** Production wiring: one adapter instance for the documents API. */
export const t13LogicCompiler: LogicCompiler = makeT13LogicCompiler();

function toIssue(diagnostic: Diagnostic): DraftValidationIssue {
  const where = diagnostic.ruleId
    ? `rule "${diagnostic.ruleId}"`
    : diagnostic.blockId
      ? `block "${diagnostic.blockId}"`
      : "logic";
  return {
    path: diagnostic.ruleId ? `logic.rules.${diagnostic.ruleId}` : `logic.${diagnostic.blockId ?? "rules"}`,
    message: `${where}: ${diagnostic.message}`,
  };
}
