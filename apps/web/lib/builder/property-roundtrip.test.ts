// Property-based round-trip tests (spec §16 testing table + golden rules #1, #2, #4;
// §21 acceptance; milestone B1 accept: "round-trip property tests pass for all 11 op
// types; undo to empty restores original; ≥100 random ops sequence stays valid").
//
// fast-check generates random documents (1–30 blocks, nested section/columns/
// multi-question-page containers, mixed question/content kinds, plus
// "future-widget" unknown-kind blocks) and random op sequences (1–100 ops).
// Asserted per run:
//   (a) every single op round-trips (apply → inverse → strict-equal doc);
//   (b) the WHOLE sequence's combined inverse undoes back to the exact original
//       (golden rule #2: undo-all returns the original) and the resulting body
//       is structurally valid AND accepted by the canonical DocumentBody schema
//       (golden rule #1);
//   (c) unknown "future-widget" blocks survive every sequence untouched
//       (golden rule #4) — the generator never removes/edits them;
//   (d) the same sequence through the editor REDUCER undoes back to the exact
//       original (history semantics, not just pure ops).

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Block, Ending, Rule } from "@formforge/schema";
import { DocumentBody as DocumentBodySchema } from "@formforge/schema";
import { editorReducer, initialEditorState } from "./store";
import { emptyBody, applyOps, invertOps, type EditableDoc, type Op } from "./ops";

// ---------------------------------------------------------------------------
// Random universe
// ---------------------------------------------------------------------------

const LEAF_KINDS = [
  "short-text", "long-text", "email", "number", "single-select", "multi-select",
  "dropdown", "rating", "nps", "file-upload",
  "text", "image", "hero", "button", "faq",
] as const;
const CONTAINERS = ["section", "columns", "multi-question-page"] as const;
const KINDS: readonly string[] = [...LEAF_KINDS, ...CONTAINERS, "future-widget"];
const WIDGET = "future-widget";

const isContainer = (kind: string): boolean => (CONTAINERS as readonly string[]).includes(kind);

// Blueprint = pure data; resolved against the EVOLVING doc at apply time so
// every emitted op is valid (targets exist, no self-subtree moves).
type Bp =
  | { t: "insert"; c: number; idx: number; k: number }
  | { t: "update"; b: number; key: number; val: number }
  | { t: "move"; b: number; c: number; idx: number }
  | { t: "remove"; b: number }
  | { t: "settings"; f: number; v: number }
  | { t: "theme"; f: number; v: number }
  | { t: "meta"; f: number; v: number }
  | { t: "endingUp"; e: number; idx: number }
  | { t: "endingRm"; e: number }
  | { t: "ruleUp"; r: number; idx: number }
  | { t: "ruleRm"; r: number };

const bpArb: fc.Arbitrary<Bp> = fc.oneof(
  fc.record({ t: fc.constant("insert" as const), c: fc.nat(6), idx: fc.nat(12), k: fc.nat(KINDS.length - 1) }),
  fc.record({ t: fc.constant("update" as const), b: fc.nat(40), key: fc.nat(9), val: fc.nat(11) }),
  fc.record({ t: fc.constant("move" as const), b: fc.nat(40), c: fc.nat(6), idx: fc.nat(12) }),
  fc.record({ t: fc.constant("remove" as const), b: fc.nat(40) }),
  fc.record({ t: fc.constant("settings" as const), f: fc.nat(11), v: fc.nat(5) }),
  fc.record({ t: fc.constant("theme" as const), f: fc.nat(7), v: fc.nat(5) }),
  fc.record({ t: fc.constant("meta" as const), f: fc.nat(3), v: fc.nat(5) }),
  fc.record({ t: fc.constant("endingUp" as const), e: fc.nat(5), idx: fc.nat(5) }),
  fc.record({ t: fc.constant("endingRm" as const), e: fc.nat(5) }),
  fc.record({ t: fc.constant("ruleUp" as const), r: fc.nat(5), idx: fc.nat(5) }),
  fc.record({ t: fc.constant("ruleRm" as const), r: fc.nat(5) }),
);

const insertBpArb: fc.Arbitrary<Bp> = fc.record({
  t: fc.constant("insert" as const),
  c: fc.nat(6),
  idx: fc.nat(12),
  k: fc.nat(KINDS.length - 1),
});

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

type FlatEntry = { block: Block; parentId: string | null; index: number };

function flatten(blocks: Block[], parentId: string | null = null, out: FlatEntry[] = []): FlatEntry[] {
  blocks.forEach((block, index) => {
    out.push({ block, parentId, index });
    if (block.children) flatten(block.children, block.id, out);
  });
  return out;
}

function subtreeHasId(block: Block, id: string): boolean {
  if (block.id === id) return true;
  return (block.children ?? []).some((c) => subtreeHasId(c, id));
}

function subtreeHasKind(block: Block, kind: string): boolean {
  if (block.kind === kind) return true;
  return (block.children ?? []).some((c) => subtreeHasKind(c, kind));
}

function newBlock(kind: string, id: string, n: number): Block {
  if (isContainer(kind)) {
    return { id, kind, props: { background: "none", padding: "md" }, children: [] };
  }
  if (kind === WIDGET) {
    return { id, kind, props: { label: `W${n}`, weird: { arr: [n, null, "x"], z: n % 2 === 0 } } };
  }
  return { id, kind, props: { label: `Label ${n}`, required: n % 2 === 0 } };
}

// ---------------------------------------------------------------------------
// Op materialization (blueprint + current doc → valid Op, or null to skip)
// ---------------------------------------------------------------------------

const UPDATE_KEYS = ["label", "required", "maxLength", "placeholder", "options"] as const;
const UPDATE_VALS: readonly unknown[] = [
  "New label text", "", true, false, 42, null, ["One", "Two"], "🌱 unicode", "A longer multi word value", 0, ["X"], "placeholder text",
];

function settingsPatch(f: number, v: number): Op {
  const on = v % 2 === 0;
  switch (f % 12) {
    case 0: return { op: "settings.update", patch: { progressBar: on } };
    case 1: return { op: "settings.update", patch: { autoAdvance: !on } };
    case 2: return { op: "settings.update", patch: { captcha: on } };
    case 3: return { op: "settings.update", patch: { showBranding: !on } };
    case 4: return { op: "settings.update", patch: { closeAt: on ? "2031-01-01T00:00:00.000Z" : null } };
    case 5: return { op: "settings.update", patch: { maxSubmissions: on ? 100 : null } };
    case 6: return { op: "settings.update", patch: { retentionDays: on ? 30 : null } };
    case 7: return { op: "settings.update", patch: { hiddenFields: on ? [{ name: "utm_source", label: "Source" }] : null } };
    case 8: return { op: "settings.update", patch: { seo: { title: on ? "SEO title" : null } } };
    case 9: return { op: "settings.update", patch: { seo: { description: on ? "SEO description" : null } } };
    case 10: return { op: "settings.update", patch: { seo: { ogImageAssetId: on ? "asset-1" : null } } };
    default: return { op: "settings.update", patch: { notifyEmails: on ? ["owner@example.com"] : [] } };
  }
}

function themePatch(f: number, v: number): Op {
  const radii = ["none", "sm", "md", "lg", "full"] as const;
  const on = v % 2 === 0;
  switch (f % 8) {
    case 0: return { op: "theme.update", patch: { radius: radii[v % radii.length] } };
    case 1: return { op: "theme.update", patch: { fontHeading: on ? "Lora" : "Inter" } };
    case 2: return { op: "theme.update", patch: { fontBody: on ? "JetBrains Mono" : "Inter" } };
    case 3: return { op: "theme.update", patch: { tokens: { "color.bg": on ? "#111111" : null } } };
    case 4: return { op: "theme.update", patch: { tokens: { "color.primary": on ? "#22c55e" : null } } };
    case 5: return { op: "theme.update", patch: { tokens: { "color.extra": on ? "#abcdef" : null } } };
    case 6: return { op: "theme.update", patch: { radius: radii[v % radii.length], tokens: { "color.bg": on ? "#222222" : null } } };
    default: return { op: "theme.update", patch: { fontHeading: on ? "Fraunces" : "Inter", fontBody: on ? "Outfit" : "Inter" } };
  }
}

function metaPatch(f: number, v: number): Op {
  const titles = ["Alpha", "Beta zeta 🔑", "Gamma"];
  const slugs = ["slug-a", "slug-b-2", null];
  switch (f % 3) {
    case 0: return { op: "meta.update", patch: { title: titles[v % titles.length] as string } };
    case 1: return { op: "meta.update", patch: { slug: slugs[v % slugs.length] as string | null } };
    default:
      return {
        op: "meta.update",
        patch: { title: titles[v % titles.length] as string, slug: slugs[(v + 1) % slugs.length] as string | null },
      };
  }
}

type Counter = { n: number };

function materialize(bp: Bp, sim: EditableDoc, counter: Counter, widgetEveryNth = 0): Op | null {
  const flat = flatten(sim.body.blocks);
  switch (bp.t) {
    case "insert": {
      const containers = flat.filter((f) => isContainer(f.block.kind));
      let kind = KINDS[bp.k % KINDS.length] as string;
      if (widgetEveryNth > 0 && counter.n % widgetEveryNth === 0) kind = WIDGET;
      const block = newBlock(kind, `n${counter.n}`, counter.n);
      counter.n += 1;
      const useParent = bp.c >= 0 && containers.length > 0;
      const parent = containers[bp.c % Math.max(containers.length, 1)];
      return {
        op: "block.insert",
        parentId: useParent && parent ? parent.block.id : null,
        index: bp.idx,
        block,
      };
    }
    case "update": {
      const target = flat[bp.b % flat.length];
      if (!target || target.block.kind === WIDGET) return null; // never edit unknown kinds
      const key = UPDATE_KEYS[bp.key % UPDATE_KEYS.length] as string;
      const val = UPDATE_VALS[bp.val % UPDATE_VALS.length];
      const clone = JSON.parse(JSON.stringify(val)) as unknown;
      return { op: "block.update", id: target.block.id, props: { [key]: clone } };
    }
    case "move": {
      const target = flat[bp.b % flat.length];
      if (!target) return null;
      // Destination = root or a container that is neither the moved block nor
      // inside its subtree (moving a block into itself is invalid — the server
      // rejects it; the client generator must never emit it).
      const containers = flat.filter(
        (f) => isContainer(f.block.kind) && !subtreeHasId(target.block, f.block.id),
      );
      const useParent = bp.c >= 0 && containers.length > 0;
      const parent = containers[bp.c % Math.max(containers.length, 1)];
      return {
        op: "block.move",
        id: target.block.id,
        parentId: useParent && parent ? parent.block.id : null,
        index: bp.idx,
      };
    }
    case "remove": {
      const target = flat[bp.b % flat.length];
      if (!target) return null;
      if (subtreeHasKind(target.block, WIDGET)) return null; // keep unknown kinds alive
      return { op: "block.remove", id: target.block.id };
    }
    case "settings":
      return settingsPatch(bp.f, bp.v);
    case "theme":
      return themePatch(bp.f, bp.v);
    case "meta":
      return metaPatch(bp.f, bp.v);
    case "endingUp": {
      const ids = [...sim.body.endings.map((e) => e.id), "end-new-0", "end-new-1"];
      const id = ids[bp.e % ids.length] as string;
      const ending: Ending = { id, title: `Ending ${id}` };
      return bp.idx % 2 === 0
        ? { op: "ending.upsert", ending }
        : { op: "ending.upsert", index: bp.idx, ending };
    }
    case "endingRm": {
      const e = sim.body.endings[bp.e % Math.max(sim.body.endings.length, 1)];
      return e ? { op: "ending.remove", id: e.id } : null;
    }
    case "ruleUp": {
      const ids = [...sim.body.logic.rules.map((r) => r.id), "rule-new-0", "rule-new-1"];
      const id = ids[bp.r % ids.length] as string;
      const rule: Rule = { id, scope: "start", when: [], then: [], isFallback: bp.r % 2 === 0 };
      return bp.idx % 2 === 0 ? { op: "rule.upsert", rule } : { op: "rule.upsert", index: bp.idx, rule };
    }
    case "ruleRm": {
      const r = sim.body.logic.rules[bp.r % Math.max(sim.body.logic.rules.length, 1)];
      return r ? { op: "rule.remove", id: r.id } : null;
    }
  }
}

// ---------------------------------------------------------------------------
// Random document builder (1–30 blocks, widgets every 3rd insert)
// ---------------------------------------------------------------------------

function buildDoc(bps: Bp[]): EditableDoc {
  let doc: EditableDoc = { meta: { title: "Prop doc" }, body: emptyBody("form") };
  const counter: Counter = { n: 0 };
  for (const bp of bps) {
    if (bp.t !== "insert") continue;
    const op = materialize(bp, doc, counter, 3); // every 3rd insert is a future-widget
    if (op) doc = applyOps(doc, [op]);
  }
  // Seed endings + a rule so ending/rule removes have targets from the start.
  doc = applyOps(doc, [
    { op: "ending.upsert", ending: { id: "end-seed-0", title: "Seed ending 0" } },
    { op: "ending.upsert", ending: { id: "end-seed-1", title: "Seed ending 1" } },
    { op: "rule.upsert", rule: { id: "rule-seed-0", scope: "start", when: [], then: [], isFallback: false } },
  ]);
  return doc;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Unique ids, no revisits (cycles), children only inside container kinds. */
function assertStructurallyValid(doc: EditableDoc): void {
  const seen = new Set<string>();
  const walk = (blocks: Block[]): void => {
    for (const block of blocks) {
      expect(seen.has(block.id), `duplicate/cyclic id ${block.id}`).toBe(false);
      seen.add(block.id);
      if (block.children && block.children.length > 0) {
        expect(CONTAINERS as readonly string[]).toContain(block.kind);
        walk(block.children);
      }
    }
  };
  walk(doc.body.blocks);
}

function widgetMap(doc: EditableDoc): Map<string, Block> {
  return new Map(
    flatten(doc.body.blocks)
      .filter((f) => f.block.kind === WIDGET)
      .map((f) => [f.block.id, f.block]),
  );
}

function expectStrictDoc(actual: EditableDoc, expected: EditableDoc): void {
  expect(actual.meta).toStrictEqual(expected.meta);
  expect(actual.body).toStrictEqual(expected.body);
}

describe("property round-trip — random docs × random op sequences (§16/§21)", () => {
  it("every op, whole sequences, undo-all, structural validity and unknown-kind survival", () => {
    fc.assert(
      fc.property(
        fc.array(insertBpArb, { minLength: 1, maxLength: 30, size: "large" }),
        fc.array(bpArb, { minLength: 1, maxLength: 100, size: "large" }),
        (docBps, opBps) => {
          const doc0 = buildDoc(docBps);
          expect(flatten(doc0.body.blocks).length).toBeGreaterThan(0);

          // Materialize the sequence against the evolving document.
          const counter: Counter = { n: 10_000 };
          const ops: Op[] = [];
          let sim = doc0;
          for (const bp of opBps) {
            const op = materialize(bp, sim, counter);
            if (!op) continue;
            const inverse = invertOps(sim, [op]);
            const after = applyOps(sim, [op]);
            // (a) per-op: apply(op) then apply(inverse) === original
            const back = applyOps(after, inverse);
            expectStrictDoc(back, sim);
            ops.push(op);
            sim = after;
          }
          // Docs that are pure-widgets (generator artifact) may skip every op —
          // retry with different inputs instead of failing the run.
          fc.pre(ops.length > 0);

          // (b) whole sequence + golden rule #2: undo-all returns the exact original.
          const restored = applyOps(sim, invertOps(doc0, ops));
          expectStrictDoc(restored, doc0);

          // Golden rule #1: no op sequence produces an invalid DocumentBody.
          assertStructurallyValid(sim);
          const parsed = DocumentBodySchema.safeParse(sim.body);
          expect(parsed.success).toBe(true);

          // Golden rule #4: unknown kinds survive untouched (props byte-identical).
          const before = widgetMap(doc0);
          const after = widgetMap(sim);
          for (const [id, block] of before) {
            const now = after.get(id);
            expect(now, `widget ${id} missing after sequence`).toBeDefined();
            expect(now).toStrictEqual(block);
            expect(JSON.stringify(now?.props)).toBe(JSON.stringify(block.props));
          }

          // (d) same sequence through the editor REDUCER: undo to empty
          // restores the original (history semantics, plain applies).
          let s = { ...initialEditorState("prop-doc"), ready: true, meta: doc0.meta, body: doc0.body };
          for (const op of ops) {
            const next = editorReducer(s, { type: "apply", ops: [op] });
            expect(next).not.toBe(s); // every op must apply cleanly in the store
            s = next;
          }
          while (s.history.past.length > 0) {
            s = editorReducer(s, { type: "undo" });
          }
          expectStrictDoc({ meta: s.meta, body: s.body }, doc0);
        },
      ),
      { numRuns: 50, timeout: 120_000 },
    );
  });

  it("≥100 random ops sequences stay valid and undo to the exact original (B1 accept)", () => {
    fc.assert(
      fc.property(
        fc.array(insertBpArb, { minLength: 5, maxLength: 20, size: "large" }),
        fc.array(bpArb, { minLength: 130, maxLength: 170, size: "max" }),
        (docBps, opBps) => {
          const doc0 = buildDoc(docBps);
          const counter: Counter = { n: 20_000 };
          const ops: Op[] = [];
          let sim = doc0;
          for (const bp of opBps) {
            const op = materialize(bp, sim, counter);
            if (!op) continue;
            ops.push(op);
            sim = applyOps(sim, [op]);
          }
          expect(ops.length).toBeGreaterThanOrEqual(100);
          assertStructurallyValid(sim);
          expect(DocumentBodySchema.safeParse(sim.body).success).toBe(true);
          expectStrictDoc(applyOps(sim, invertOps(doc0, ops)), doc0);
        },
      ),
      { numRuns: 20, timeout: 120_000 },
    );
  });

  it("coalescing preserves round-trip semantics: typing bursts undo to the original", () => {
    // Random keystroke patches on one block, coalesced in the store — undo
    // must still restore the exact pre-typing doc (§3.3 + §21 earliest inverse).
    fc.assert(
      fc.property(
        fc.array(fc.record({ label: fc.string({ minLength: 1, maxLength: 8 }), extra: fc.nat(3) }), {
          minLength: 2,
          maxLength: 30,
          size: "large",
        }),
        (keystrokes) => {
          const block: Block = { id: "q1", kind: "short-text", props: { label: "Start" } };
          const doc0: EditableDoc = {
            meta: { title: "T" },
            body: { ...emptyBody("form"), blocks: [block] },
          };
          let s = { ...initialEditorState("coalesce-prop"), ready: true, meta: doc0.meta, body: doc0.body };
          keystrokes.forEach((k, i) => {
            s = editorReducer(s, {
              type: "apply",
              ops: [{ op: "block.update", id: "q1", props: { label: k.label, extra: k.extra } }],
              coalesce: { key: "update:q1", at: i * 50 }, // all within the window
            });
          });
          // Everything coalesced into ONE entry whose inverse restores the start.
          expect(s.history.past.length).toBe(1);
          while (s.history.past.length > 0) {
            s = editorReducer(s, { type: "undo" });
          }
          expectStrictDoc({ meta: s.meta, body: s.body }, doc0);
        },
      ),
      { numRuns: 30, timeout: 60_000 },
    );
  });
});

// Compile-time pin: the wire body type stays the canonical schema output.
type _BodyCheck = ReturnType<typeof DocumentBodySchema.parse> extends EditableDoc["body"] ? true : false;
const _bodyCheck: _BodyCheck = true;
void _bodyCheck;
