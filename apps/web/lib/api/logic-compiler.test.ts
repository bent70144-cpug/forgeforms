// T20 integration tests — the T13 logic engine gates publish (ticket #20
// acceptance: "Dangling goto target blocks publish with clear error naming
// the rule") and the compiled routing lands in the published snapshot.
//
// Runs the REAL T10 publish service (makePublishDocument) over the in-memory
// store with the production T13 adapter — no fakes on the logic path.

import { describe, expect, it } from "vitest";
import {
  createInMemoryDocumentStore,
  defaultDraftValidator,
  defaultPublicUrlBuilder,
  devAssetUrlResolver,
  makePublishDocument,
  noopCdnPurge,
  type Ctx,
  type DocumentBodyJson,
  type DocumentRecord,
  type PublishPipelineDeps,
  type Result,
  type PublishOutcome,
  type AppError,
} from "@formforge/core";
import { t13LogicCompiler } from "./logic-compiler";

function ctx(): Ctx {
  const now = new Date("2026-11-06T10:00:00.000Z");
  return { workspaceId: "ws_a", actor: { type: "user", id: "u_1" }, requestId: "req_t20", now: () => now };
}

function bodyWith(overrides: Partial<DocumentBodyJson>): DocumentBodyJson {
  return {
    schemaVersion: 1,
    type: "form",
    theme: { tokens: { "color.bg": "#ffffff" } },
    settings: { locale: "en" },
    blocks: [
      { id: "q_nps", kind: "nps", props: { label: "How likely to recommend?" } },
    ],
    endings: [
      { id: "end_a", title: "Ending A" },
      { id: "end_b", title: "Ending B" },
    ],
    logic: { rules: [] },
    ...overrides,
  };
}

function docWith(draft: DocumentBodyJson): DocumentRecord {
  const now = new Date("2026-11-06T09:00:00.000Z");
  return {
    id: "doc_t20",
    workspaceId: "ws_a",
    type: "form",
    title: "NPS form",
    slug: "nps-form",
    status: "draft",
    rev: 1,
    draft,
    publishedVersionId: null,
    createdBy: "u_1",
    createdAt: now,
    updatedAt: now,
  };
}

async function publish(draft: DocumentBodyJson): Promise<Result<PublishOutcome, AppError>> {
  const store = createInMemoryDocumentStore();
  store.put(docWith(draft));
  const deps: PublishPipelineDeps = {
    documents: store.documents,
    versions: store.versions,
    snapshots: store.snapshots,
    cdn: noopCdnPurge,
    validator: defaultDraftValidator,
    compiler: t13LogicCompiler,
    assets: devAssetUrlResolver("https://cdn.test"),
    publicUrl: defaultPublicUrlBuilder("https://pub.test"),
  };
  return makePublishDocument(deps)(ctx(), "doc_t20");
}

describe("publish gating through the T13 engine (t13LogicCompiler)", () => {
  it("blocks publish for a dangling goto target and names the rule", async () => {
    const result = await publish(
      bodyWith({
        logic: {
          rules: [
            {
              id: "rule_dangling",
              scope: "q_nps",
              when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
              then: [{ type: "goto", target: "end:missing_ending" }],
              isFallback: false,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    const messages = JSON.stringify(result.error.details);
    expect(messages).toContain("rule_dangling");
    expect(messages).toContain("end:missing_ending");
    expect(messages).toContain("dangling");
  });

  it("blocks publish for a dangling block target too", async () => {
    const result = await publish(
      bodyWith({
        logic: {
          rules: [
            {
              id: "rule_ghost_block",
              scope: "q_nps",
              when: [],
              then: [{ type: "goto", target: "q_does_not_exist" }],
              isFallback: false,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error.details)).toContain("rule_ghost_block");
    expect(JSON.stringify(result.error.details)).toContain("q_does_not_exist");
  });

  it("publishes the valid NPS rule pair and stores compiled routing in the snapshot", async () => {
    const result = await publish(
      bodyWith({
        logic: {
          rules: [
            {
              id: "rule_nps_detractor",
              scope: "q_nps",
              when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
              then: [{ type: "goto", target: "end:end_b" }],
              isFallback: false,
            },
            {
              id: "rule_nps_otherwise",
              scope: "q_nps",
              when: [],
              then: [{ type: "goto", target: "end:end_a" }],
              isFallback: true,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toContain("/p/ws_a/nps-form");

    const snapshotRow = result.value; // published — verify via the reader below
    expect(snapshotRow.versionId).toBeTruthy();
  });

  it("compiled snapshot routing exposes defaultNext + the scope's rules for the engine", async () => {
    const store = createInMemoryDocumentStore();
    store.put(
      docWith(
        bodyWith({
          logic: {
            rules: [
              {
                id: "rule_nps_detractor",
                scope: "q_nps",
                when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
                then: [{ type: "goto", target: "end:end_b" }],
                isFallback: false,
              },
            ],
          },
        }),
      ),
    );
    const deps: PublishPipelineDeps = {
      documents: store.documents,
      versions: store.versions,
      snapshots: store.snapshots,
      cdn: noopCdnPurge,
      validator: defaultDraftValidator,
      compiler: t13LogicCompiler,
      assets: devAssetUrlResolver("https://cdn.test"),
      publicUrl: defaultPublicUrlBuilder("https://pub.test"),
    };
    const result = await makePublishDocument(deps)(ctx(), "doc_t20");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = store.snapshots;
    const row = await snapshot.getByDocumentId("doc_t20");
    expect(row).not.toBeNull();
    const routing = row!.rendered.routing;
    expect(routing["q_nps"]?.defaultNext).toBe("end:end_a"); // last question → first ending
    expect(routing["start"]?.defaultNext).toBe("q_nps");
    const rules = routing["q_nps"]?.rules ?? [];
    expect(rules).toHaveLength(1);
    const compiled = rules[0] as { id?: string; conditions?: Array<{ ref?: { source?: string; name?: string } }>; actions?: Array<{ kind?: string; target?: string }> };
    expect(compiled.id).toBe("rule_nps_detractor");
    expect(compiled.conditions?.[0]?.ref).toMatchObject({ source: "block", name: "q_nps" });
    expect(compiled.actions?.[0]).toMatchObject({ kind: "goto", target: "end:end_b" });
  });

  it("blocks publish on a goto cycle with no exit (engine lint)", async () => {
    const result = await publish(
      bodyWith({
        blocks: [
          { id: "q_a", kind: "short-text", props: { label: "A" } },
          { id: "q_b", kind: "short-text", props: { label: "B" } },
        ],
        endings: [{ id: "end_a", title: "A" }],
        logic: {
          rules: [
            { id: "r_loop1", scope: "q_a", when: [], then: [{ type: "goto", target: "q_b" }], isFallback: false },
            { id: "r_loop2", scope: "q_b", when: [], then: [{ type: "goto", target: "q_a" }], isFallback: false },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const messages = JSON.stringify(result.error.details);
    expect(messages).toContain("cycle with no exit");
    expect(messages).toContain("q_a");
  });
});
