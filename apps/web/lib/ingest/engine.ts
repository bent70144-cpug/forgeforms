// T20 — ingest runtime engine wiring: the ONLY evaluate implementation the
// public ingest API uses, imported from T13's logic package
// (`@formforge/core/logic` — single engine surface for client and server,
// spec §15 M5 acceptance). T13's engine files are consumed unchanged.
//
// Also provides the compiled-routing fallback for snapshots that predate the
// T13-based publish compiler (routing empty + raw logic rules present): it
// compiles through the SAME engine instead of the old raw-rule `compileLite`.

import { compile as engineCompile, evaluate as engineEvaluateFn, routeMap as engineRouteMap } from "@formforge/core/logic";
import type { Block, Rule } from "@formforge/core/bridge";
import type { LogicEvaluate, Snapshot } from "@formforge/core/bridge";

/**
 * `LogicEvaluate` adapter over T13's `evaluate`. T13 accepts the flat
 * `Record<string, RouteNode>` snapshot routing (structural detection) plus
 * partial ctx, so the adapter is a straight pass-through; the cast keeps the
 * bridge's legacy `LogicEvaluate` signature (flat raw routing) happy until
 * the lead unifies the bridge types with the engine package.
 */
export const engineEvaluate = engineEvaluateFn as unknown as LogicEvaluate;

/**
 * Compiled routing (T13 `routeMap` projection of `compile()`) for snapshots
 * built before the T13-based publish compiler landed. Produces COMPILED
 * route nodes (pre-parsed conditions/actions) — exactly what T13's evaluate
 * consumes. Cast mirrors `engineEvaluate` (structural bridge debt).
 */
export function compiledRouting(
  rules: readonly Rule[] | null | undefined,
  blocks: readonly Block[] | null | undefined,
  endings: ReadonlyArray<{ id: string }> | readonly string[] | null | undefined,
): Snapshot["routing"] {
  const endingIds = (endings ?? []).map((e) =>
    typeof e === "string" ? e : (e as { id: string }).id,
  );
  const compiled = engineCompile(rules ?? [], blocks ?? [], endingIds);
  return engineRouteMap(compiled) as unknown as Snapshot["routing"];
}
