// T20 — ingest runtime engine wiring: the ONLY evaluate implementation the
// public ingest API uses, imported from T13's logic package
// (`@formforge/core/logic` — single engine surface for client and server,
// spec §15 M5 acceptance). T13's engine files are consumed unchanged.
//
// Also provides the compiled-routing fallback for snapshots that predate the
// T13-based publish compiler (routing empty + raw logic rules present): it
// compiles through the SAME engine instead of the old raw-rule `compileLite`.
//
// ISSUE #30: the retired core bridge's legacy `LogicEvaluate`/`Snapshot`
// types are gone — `LogicEvaluate` is now the canonical T13 alias and
// `IngestSnapshot` (routing: RouteMap) comes from @formforge/core
// (submissions plane), so the old `as unknown as` casts dropped out.

import { compile as engineCompile, evaluate as engineEvaluateFn, routeMap as engineRouteMap } from "@formforge/core/logic";
import type { Block, Rule } from "@formforge/core/logic";
import type { IngestSnapshot } from "@formforge/core";

/**
 * `LogicEvaluate` adapter over T13's `evaluate`. T13 accepts the flat
 * `Record<string, RouteNode>` snapshot routing (structural detection) plus
 * partial ctx — a straight pass-through now that the DI type is canonical.
 */
export const engineEvaluate = engineEvaluateFn;

/**
 * Compiled routing (T13 `routeMap` projection of `compile()`) for snapshots
 * built before the T13-based publish compiler landed. Produces COMPILED
 * route nodes (pre-parsed conditions/actions) — exactly what T13's evaluate
 * consumes, and exactly `IngestSnapshot["routing"]`.
 */
export function compiledRouting(
  rules: readonly Rule[] | null | undefined,
  blocks: readonly Block[] | null | undefined,
  endings: ReadonlyArray<{ id: string }> | readonly string[] | null | undefined,
): IngestSnapshot["routing"] {
  const endingIds = (endings ?? []).map((e) =>
    typeof e === "string" ? e : (e as { id: string }).id,
  );
  return engineRouteMap(engineCompile(rules ?? [], blocks ?? [], endingIds));
}
