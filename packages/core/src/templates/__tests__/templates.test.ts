// W1-22 (issue #22) — template catalog + instantiation test suite.
// Covers the ticket's quality bar:
//   - every template validates against the DocumentBody schema (bridge until T06);
//   - unique block/ending ids within a template;
//   - logic references resolve (scopes, @block operands, goto targets);
//   - instantiateTemplate deep-clones (mutation safety) and regenerates ids;
//   - gallery composition per spec §14.1.9 (≥6 forms, ≥4 pages, ≥4 portfolios).
import { describe, expect, it } from "vitest";

import { DocumentBody, TEMPLATE_BLOCK_KINDS } from "../schema";
import { getTemplate, instantiateTemplate, listTemplates } from "../service";
import { templateRegistry } from "../data";
import type { Block } from "../schema";
import type { InstantiateCtx } from "../types";

const ctx: InstantiateCtx = {
  workspaceId: "ws_test",
  actor: { type: "user", id: "user_test" },
  requestId: "req_test",
  now: () => new Date("2026-01-01T00:00:00.000Z"),
};

function collectIds(blocks: readonly Block[], into: string[] = []): string[] {
  for (const b of blocks) {
    into.push(b.id);
    if (b.children) collectIds(b.children, into);
  }
  return into;
}

describe("template catalog", () => {
  it("exposes at least 14 templates", () => {
    expect(templateRegistry.length).toBeGreaterThanOrEqual(14);
    expect(listTemplates().length).toBe(templateRegistry.length);
  });

  it("meets the spec §14.1.9 composition: ≥6 forms, ≥4 pages, ≥4 portfolios", () => {
    const forms = listTemplates({ category: "form" });
    const pages = listTemplates({ category: "page" });
    const portfolios = listTemplates({ category: "portfolio" });
    expect(forms.length).toBeGreaterThanOrEqual(6);
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(portfolios.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique template ids and metadata basics", () => {
    const ids = templateRegistry.map((t) => t.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templateRegistry) {
      expect(t.meta.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.meta.name.length).toBeGreaterThan(2);
      expect(t.meta.description.length).toBeGreaterThan(20);
      expect(t.meta.gradient).toMatch(/^from-/);
      expect(t.meta.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("listTemplates filters by category and tag", () => {
    const surveys = listTemplates({ tag: "survey" });
    expect(surveys.length).toBeGreaterThanOrEqual(2);
    for (const s of surveys) expect(s.tags).toContain("survey");
    expect(listTemplates({ category: "form" }).every((t) => t.category === "form")).toBe(true);
  });
});

describe("template bodies", () => {
  it("every template parses against the DocumentBody schema", () => {
    for (const def of templateRegistry) {
      const result = DocumentBody.safeParse(def.body);
      const issues = result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      expect(issues, `${def.meta.id} must validate`).toEqual([]);
      expect(result.success).toBe(true);
    }
  });

  it("every template body has expected envelope fields", () => {
    for (const def of templateRegistry) {
      const parsed = DocumentBody.parse(def.body);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.type).toBe(def.meta.category);
      expect(parsed.blocks.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.endings)).toBe(true);
      expect(Array.isArray(parsed.logic.rules)).toBe(true);
      expect(Object.keys(parsed.theme.tokens).length).toBeGreaterThan(0);
    }
  });

  it("block ids are unique within each template (recursive)", () => {
    for (const def of templateRegistry) {
      const ids = collectIds(def.body.blocks);
      expect(new Set(ids).size, `${def.meta.id} duplicate block ids`).toBe(ids.length);
    }
  });

  it("ending ids are unique and select-option ids are unique per block", () => {
    for (const def of templateRegistry) {
      const endingIds = (def.body.endings ?? []).map((e) => e.id);
      expect(new Set(endingIds).size).toBe(endingIds.length);

      for (const b of def.body.blocks) {
        const opts = (b.props["options"] as { id: string }[] | undefined) ?? [];
        const optIds = opts.map((o) => o.id);
        expect(new Set(optIds).size, `${def.meta.id}/${b.id} duplicate option ids`).toBe(optIds.length);
      }
    }
  });

  it("logic references resolve: scopes, @block operands and goto targets", () => {
    for (const def of templateRegistry) {
      const blockIds = new Set(collectIds(def.body.blocks));
      const endingIds = new Set((def.body.endings ?? []).map((e) => e.id));
      for (const r of def.body.logic?.rules ?? []) {
        expect(
          r.scope === "start" || blockIds.has(r.scope),
          `${def.meta.id} rule ${r.id}: dangling scope ${r.scope}`,
        ).toBe(true);
        for (const w of r.when) {
          if (w.left.startsWith("@block:")) {
            expect(blockIds.has(w.left.slice("@block:".length)), `${def.meta.id} rule ${r.id}: dangling ${w.left}`).toBe(true);
          }
        }
        for (const action of r.then) {
          if (action.type === "goto") {
            const ok = action.target.startsWith("end:")
              ? endingIds.has(action.target.slice("end:".length))
              : blockIds.has(action.target);
            expect(ok, `${def.meta.id} rule ${r.id}: dangling goto ${action.target}`).toBe(true);
          }
        }
      }
    }
  });

  it("only uses block kinds from the declared template subset", () => {
    const allowed = new Set<string>(TEMPLATE_BLOCK_KINDS);
    for (const def of templateRegistry) {
      collectIds(def.body.blocks); // sanity: walk works
      const kinds: string[] = [];
      const walk = (blocks: readonly Block[]): void => {
        for (const b of blocks) {
          kinds.push(b.kind);
          if (b.children) walk(b.children);
        }
      };
      walk(def.body.blocks);
      for (const k of kinds) expect(allowed.has(k), `${def.meta.id} uses unexpected kind ${k}`).toBe(true);
    }
  });

  it("page and portfolio templates ship without endings; forms ship at least one", () => {
    for (const def of templateRegistry) {
      const endings = def.body.endings ?? [];
      if (def.meta.category === "form") expect(endings.length, def.meta.id).toBeGreaterThanOrEqual(1);
      else expect(endings.length, def.meta.id).toBe(0);
    }
  });

  it("getTemplate returns null for unknown ids and deep-frozen data for known ids", () => {
    expect(getTemplate("nope-not-real")).toBeNull();
    const t = getTemplate("contact-form");
    expect(t).not.toBeNull();
    expect(() => {
      (t as { body: { blocks: { id: string }[] } }).body.blocks[0]!.id = "mutated";
    }).toThrow();
  });
});

describe("instantiateTemplate", () => {
  it("returns NOT_FOUND for unknown templates", () => {
    const result = instantiateTemplate(ctx, "does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("produces a valid payload with fresh block and ending ids", () => {
    const result = instantiateTemplate(ctx, "nps-survey");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const source = getTemplate("nps-survey")!;
    const sourceIds = new Set(collectIds(source.body.blocks));
    const newIds = collectIds(result.data.body.blocks);

    // Fresh ids: no overlap with the catalog's authored ids, all unique.
    for (const id of newIds) expect(sourceIds.has(id), `stale id reused: ${id}`).toBe(false);
    expect(new Set(newIds).size).toBe(newIds.length);

    const sourceEndingIds = new Set(source.body.endings.map((e) => e.id));
    const newEndingIds = result.data.body.endings.map((e) => e.id);
    for (const id of newEndingIds) expect(sourceEndingIds.has(id)).toBe(false);
    expect(new Set(newEndingIds).size).toBe(newEndingIds.length);
  });

  it("remaps logic references to the fresh ids", () => {
    const result = instantiateTemplate(ctx, "nps-survey");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const body = result.data.body;
    const blockIds = new Set(collectIds(body.blocks));
    const endingIds = new Set(body.endings.map((e) => e.id));
    expect(body.logic.rules.length).toBeGreaterThan(0);

    for (const r of body.logic.rules) {
      expect(r.scope === "start" || blockIds.has(r.scope)).toBe(true);
      for (const w of r.when) {
        if (w.left.startsWith("@block:")) {
          expect(blockIds.has(w.left.slice("@block:".length)), `dangling ${w.left}`).toBe(true);
        }
      }
      for (const action of r.then) {
        if (action.type === "goto") {
          const ok = action.target.startsWith("end:")
            ? endingIds.has(action.target.slice("end:".length))
            : blockIds.has(action.target);
          expect(ok, `dangling goto ${action.target}`).toBe(true);
        }
      }
    }

    // No authored id survives in any logic reference (scope, operand, goto target).
    const source = getTemplate("nps-survey")!;
    const refStrings = body.logic.rules.flatMap((r) => [
      r.scope,
      ...r.when.map((w) => w.left),
      ...r.then.filter((a) => a.type === "goto").map((a) => (a as { target: string }).target),
    ]);
    for (const oldId of collectIds(source.body.blocks)) {
      const stale =
        refStrings.includes(oldId) ||
        refStrings.includes(`@block:${oldId}`) ||
        refStrings.includes(`end:${oldId}`);
      expect(stale, `stale reference to authored id ${oldId}`).toBe(false);
    }
  });

  it("preserves structure and content while cloning (branching templates included)", () => {
    for (const id of ["product-quiz", "event-rsvp", "customer-feedback", "product-landing", "designer-portfolio"]) {
      const source = getTemplate(id)!;
      const result = instantiateTemplate(ctx, id);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const kinds = (blocks: Block[]): string[] => blocks.flatMap((b) => [b.kind, ...(b.children ? kinds(b.children) : [])]);
      expect(kinds(result.data.body.blocks)).toEqual(kinds(source.body.blocks));
      expect(result.data.body.blocks.map((b) => b.props)).toEqual(source.body.blocks.map((b) => b.props));
      expect(result.data.body.type).toBe(source.body.type);
      expect(result.data.body.theme).toEqual(source.body.theme);
      expect(result.data.title).toBe(source.meta.name);
    }
  });

  it("deep-clones: mutating one instance never affects the catalog or another instance", () => {
    const a = instantiateTemplate(ctx, "contact-form");
    const before = JSON.stringify(getTemplate("contact-form")!.body);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    // Mutate the first instance aggressively.
    const firstBlock = a.data.body.blocks[0]!;
    firstBlock.props["richText"] = "<p>hacked</p>";
    firstBlock.hidden = true;
    a.data.body.settings.showBranding = false;
    a.data.body.endings.push({ id: "end_extra", title: "extra" });
    a.data.body.logic.rules.push({ id: "r_x", scope: "start", when: [], then: [], isFallback: false });

    // The catalog is untouched…
    expect(JSON.stringify(getTemplate("contact-form")!.body)).toBe(before);
    // …and a second instantiation is unaffected too.
    const b = instantiateTemplate(ctx, "contact-form");
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(JSON.stringify(b.data.body)).not.toBe(JSON.stringify(a.data.body));
    expect(b.data.body.endings.some((e) => e.id === "end_extra")).toBe(false);
    expect(b.data.body.settings.showBranding).toBe(true);
  });

  it("honors a custom title and stamps instantiation context", () => {
    const result = instantiateTemplate(ctx, "contact-form", { title: "Support inbox" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.title).toBe("Support inbox");
    expect(result.data.templateId).toBe("contact-form");
    expect(result.data.type).toBe("form");
    expect(result.data.instantiatedBy).toEqual({
      workspaceId: "ws_test",
      actorType: "user",
      actorId: "user_test",
      requestId: "req_test",
    });
  });

  it("re-validates the remapped body against DocumentBody", () => {
    const result = instantiateTemplate(ctx, "product-quiz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(DocumentBody.safeParse(result.data.body).success).toBe(true);
  });
});
