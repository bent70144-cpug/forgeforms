// Table-driven golden runner (spec §9 tests, issue #13).
// Every case file is an array of cases; each case compiles rules+blocks,
// asserts the (normalized) lint diagnostics, then runs every recorded step
// through evaluate() — once against the full Routing and once against the
// flat RouteMap snapshot shape.
//
// SPEC-NOTE: the W1-13 task brief mentions a `__golden__/` fixtures folder,
// but spec §9 and issue #13 pin the golden cases at
// `logic/__tests__/cases/*.json` — that is what lives here.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile, evaluate, routeMap } from "../index.js";
import type {
  Block,
  Diagnostic,
  DiagnosticCode,
  EvaluateResult,
  RouteMap,
  Routing,
  Rule,
} from "../index.js";

interface GoldenStep {
  ctx: unknown;
  expect: { nextBlockId: string; variables?: Record<string, unknown> };
}

/** Case over raw rules + blocks (the common kind). */
interface GoldenCompileCase {
  name: string;
  rules: Rule[];
  blocks: Block[];
  endings?: string[];
  expectDiagnostics?: Array<{ code: DiagnosticCode; ruleId: string | null; blockId: string | null }>;
  steps: GoldenStep[];
}

/** Case that feeds a hand-built (possibly broken) program straight to evaluate(). */
interface GoldenRawCase {
  name: string;
  rawRouting: unknown;
  steps: GoldenStep[];
}

type GoldenCase = GoldenCompileCase | GoldenRawCase;

function isRawCase(c: GoldenCase): c is GoldenRawCase {
  return Object.prototype.hasOwnProperty.call(c, "rawRouting");
}

const casesDir = new URL("./cases/", import.meta.url);
const files = readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort();

const allCases: Array<{ file: string; c: GoldenCase }> = [];
for (const file of files) {
  const parsed = JSON.parse(readFileSync(new URL(file, casesDir), "utf8")) as GoldenCase[];
  for (const c of parsed) allCases.push({ file, c });
}

function normalizeDiagnostics(diags: readonly Diagnostic[]): Array<{
  code: DiagnosticCode;
  ruleId: string | null;
  blockId: string | null;
}> {
  return diags
    .map((x) => ({ code: x.code, ruleId: x.ruleId ?? null, blockId: x.blockId ?? null }))
    .sort((a, b) =>
      `${a.code}\u0000${a.ruleId ?? ""}\u0000${a.blockId ?? ""}`.localeCompare(
        `${b.code}\u0000${b.ruleId ?? ""}\u0000${b.blockId ?? ""}`,
      ),
    );
}

function runStep(program: Routing | RouteMap, step: GoldenStep): EvaluateResult {
  return evaluate(program, step.ctx as never);
}

describe("golden cases", () => {
  for (const { file, c } of allCases) {
    it(`${file} › ${c.name}`, () => {
      if (isRawCase(c)) {
        for (const step of c.steps) {
          const result = runStep(c.rawRouting as Routing | RouteMap, step);
          expect(result.nextBlockId).toBe(step.expect.nextBlockId);
          expect(result.variables).toEqual(step.expect.variables ?? {});
        }
        return;
      }

      const routing = compile(c.rules, c.blocks, c.endings ?? []);
      const expectedDiags = c.expectDiagnostics ?? [];
      expect(normalizeDiagnostics(routing.diagnostics)).toEqual(
        [...expectedDiags].sort((a, b) =>
          `${a.code}\u0000${a.ruleId ?? ""}\u0000${a.blockId ?? ""}`.localeCompare(
            `${b.code}\u0000${b.ruleId ?? ""}\u0000${b.blockId ?? ""}`,
          ),
        ),
      );

      const flat = routeMap(routing);
      for (const step of c.steps) {
        const result = runStep(routing, step);
        expect(result.nextBlockId).toBe(step.expect.nextBlockId);
        expect(result.variables).toEqual(step.expect.variables ?? {});

        // The flat snapshot shape (spec §8) must evaluate identically.
        const viaFlat = runStep(flat, step);
        expect(viaFlat.nextBlockId).toBe(step.expect.nextBlockId);
        expect(viaFlat.variables).toEqual(step.expect.variables ?? {});
      }
    });
  }

  it("suite carries at least 40 golden cases (issue #13 AC)", () => {
    expect(allCases.length).toBeGreaterThanOrEqual(40);
  });

  it("case files are sorted and non-empty", () => {
    expect(files.length).toBeGreaterThan(0);
    expect([...files].sort()).toEqual(files);
  });
});
