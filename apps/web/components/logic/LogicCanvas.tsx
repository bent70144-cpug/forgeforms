"use client";

// Logic builder canvas (spec §14.1.4): React Flow canvas — nodes = start,
// question blocks, endings; edges = default flow (document order) + dashed
// terracotta rule goto edges. Pure presentation: the graph model comes from
// lib/logic/graph.ts (unit-tested); clicking a node opens the rule drawer.
//
// Meridian redesign (task 10/13): the canvas is a clean diagramming sheet —
// paper background with a 16px dot grid (border-strong at 18%), white hairline
// node cards (ultramarine 1.5px border + 4% tint on the open scope), quiet
// tinted type tiles, border-strong flow edges vs dashed terracotta goto edges
// with white pill labels in mono microtext, and white hairline Controls +
// MiniMap chrome. Node data + graph mapping logic is unchanged.

import { useMemo } from "react";
import {
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LogicGraph } from "@/lib/logic/graph";
import { Icon, type IconName } from "@/components/ui/icons";

export type LogicCanvasProps = {
  graph: LogicGraph;
  /** Currently open scope id (canvas node id) or null. */
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
};

type LogicNodeData = {
  label: string;
  kind: "start" | "question" | "ending";
  questionKind?: string;
  active: boolean;
};

type FlowNode = Node<LogicNodeData, "start" | "question" | "ending">;

/* ---------------------------------------------------------------------------
 * Node chrome (Meridian sheet)
 * ------------------------------------------------------------------------ */

/* Shared node surface — white card, 1px hairline, paper shadow. */
const NODE_SURFACE =
  "border border-[var(--ff-border)] bg-[var(--ff-card)] shadow-[var(--ff-shadow-sm)]";
/* Open scope: ~1.5px ultramarine border (1px border + 0.5px ring, so the box
   doesn't shift) plus a 4% ultramarine tint over the card white. */
const NODE_ACTIVE =
  "border-[var(--ff-primary)] bg-[color-mix(in_srgb,var(--ff-primary)_4%,var(--ff-card))] shadow-[0_0_0_0.5px_var(--ff-primary),var(--ff-shadow-sm)]";

const NODE_TRANSITION = "transition-[border-color,box-shadow,background-color] duration-150";

/* Type tiles: quiet ultramarine tint for start/question, terracotta for endings. */
const TILE_BASE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]";
const TILE_QUESTION = `${TILE_BASE} border border-[color-mix(in_srgb,var(--ff-primary)_22%,transparent)] bg-[color-mix(in_srgb,var(--ff-primary)_8%,var(--ff-card))] text-[var(--ff-primary)]`;
const TILE_ENDING = `${TILE_BASE} border border-[color-mix(in_srgb,var(--ff-accent)_22%,transparent)] bg-[color-mix(in_srgb,var(--ff-accent)_8%,var(--ff-card))] text-[var(--ff-accent)]`;

/* Node headers: Sora 600 @ 13px (non-heading spans take the display font
   inline — same convention as the builder shell). */
const HEADER_FONT = { fontFamily: "var(--ff-font-heading)" } as const;

/* Question kind → tile icon (presentation only; unknown kinds fall back). */
const QUESTION_TILE_ICONS: Record<string, IconName> = {
  "short-text": "file",
  "long-text": "fileText",
  email: "mail",
  number: "chart",
  "single-select": "list",
  "multi-select": "list",
  dropdown: "chevronDown",
  rating: "sparkles",
  nps: "chart",
};

function questionTileIcon(questionKind?: string): IconName {
  return (questionKind !== undefined && QUESTION_TILE_ICONS[questionKind]) || "info";
}

/* Ultramarine handles with a card-white rim so they sit cleanly on the sheet. */
const HANDLE_STYLE = {
  width: 9,
  height: 9,
  background: "var(--ff-primary)",
  border: "2px solid var(--ff-card)",
  boxShadow: "0 0 0 1px color-mix(in srgb, var(--ff-primary) 30%, transparent)",
} as const;

function StartNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-[var(--ff-radius)] px-3 py-2 ${NODE_SURFACE} ${NODE_TRANSITION} ${
        data.active ? NODE_ACTIVE : ""
      }`}
    >
      <span aria-hidden="true" className={TILE_QUESTION}>
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 fill-current">
          <path d="M3 1.6a.8.8 0 0 1 1.22-.68l6.4 4.4a.8.8 0 0 1 0 1.36l-6.4 4.4A.8.8 0 0 1 3 10.4Z" />
        </svg>
      </span>
      <span
        className="pr-0.5 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ff-fg)]"
        style={HEADER_FONT}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

function QuestionNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex w-[220px] items-center gap-2.5 rounded-[var(--ff-radius)] px-3 py-2.5 ${NODE_SURFACE} ${NODE_TRANSITION} ${
        data.active ? NODE_ACTIVE : ""
      }`}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <span aria-hidden="true" className={TILE_QUESTION}>
        <Icon name={questionTileIcon(data.questionKind)} size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-[12px] leading-3 text-[var(--ff-muted)]">
          {data.questionKind ?? "question"}
        </span>
        <span
          className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-[var(--ff-fg)]"
          style={HEADER_FONT}
          title={data.label}
        >
          {data.label}
        </span>
      </span>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

function EndingNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex w-[200px] items-center gap-2.5 rounded-[var(--ff-radius)] px-3 py-2.5 ${NODE_SURFACE} ${NODE_TRANSITION} ${
        data.active ? NODE_ACTIVE : ""
      }`}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <span aria-hidden="true" className={TILE_ENDING}>
        <Icon name="check" size={15} />
      </span>
      <span
        className="truncate text-[13px] font-semibold text-[var(--ff-fg)]"
        style={HEADER_FONT}
        title={data.label}
      >
        {data.label}
      </span>
    </div>
  );
}

const NODE_TYPES = {
  start: StartNode,
  question: QuestionNode,
  ending: EndingNode,
};

/* Mini-map node colors — ultramarine for start/questions, terracotta for endings. */
function miniMapNodeColor(node: FlowNode): string {
  if (node.data.kind === "ending") return "var(--ff-accent)";
  if (node.data.kind === "start") return "var(--ff-primary)";
  return "color-mix(in srgb, var(--ff-primary) 45%, var(--ff-border-strong))";
}

/*
 * Scoped restyles for React Flow chrome that exposes no className props:
 *  · sheet → paper background with a fixed 16px dot grid (border-strong 18%)
 *  · selected / open-scope edges → ultramarine 2px (no glow)
 *  · Controls + MiniMap → white hairline cards (focus-visible comes from the
 *    shared react-flow rules in globals.css)
 * Kept in one small block (no globals.css edits allowed); all colors are
 * tokens. The dot grid lives on the pane rather than xyflow's <Background>
 * because SVG pattern fills don't resolve var()/color-mix values.
 */
const FLOW_CHROME_CSS = `
.ff-logic-flow .react-flow,
.ff-logic-flow .react-flow__pane {
  background-color: var(--ff-bg);
}
.ff-logic-flow .react-flow__pane {
  background-image: radial-gradient(
    color-mix(in srgb, var(--ff-border-strong) 18%, transparent) 1px,
    transparent 1.2px
  );
  background-size: 16px 16px;
}
.ff-logic-flow .react-flow__edge.selected .react-flow__edge-path,
.ff-logic-flow .react-flow__edge.ff-edge-active .react-flow__edge-path {
  stroke: var(--ff-primary) !important;
  stroke-width: 2px !important;
}
.ff-logic-flow .react-flow__controls {
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--ff-card);
  box-shadow: var(--ff-shadow-sm);
}
.ff-logic-flow .react-flow__controls-button {
  width: 30px;
  height: 30px;
  border: none;
  border-bottom: 1px solid var(--ff-border);
  border-radius: 0;
  background: var(--ff-card);
  color: var(--ff-muted);
  transition:
    background-color 150ms var(--ff-ease-out),
    color 150ms var(--ff-ease-out);
}
.ff-logic-flow .react-flow__controls-button:last-child { border-bottom: none; }
.ff-logic-flow .react-flow__controls-button:hover {
  background: color-mix(in srgb, var(--ff-primary) 7%, var(--ff-card));
  color: var(--ff-fg);
}
.ff-logic-flow .react-flow__controls-button svg { fill: currentColor; }
.ff-logic-flow .react-flow__minimap {
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  background: var(--ff-card);
  box-shadow: var(--ff-shadow-sm);
  overflow: hidden;
}
.ff-logic-flow .react-flow__minimap svg { background: transparent; }
`;

export function LogicCanvas({ graph, selectedId, onSelect }: LogicCanvasProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const questionIndex = new Map<string, number>();
    let q = 0;
    for (const node of graph.nodes) {
      if (node.kind === "question") questionIndex.set(node.id, q++);
    }
    const endings = graph.nodes.filter((n) => n.kind === "ending");
    const endingIndex = new Map<string, number>();
    endings.forEach((node, i) => endingIndex.set(node.id, i));

    const nodes: FlowNode[] = graph.nodes.map((node) => {
      const position =
        node.kind === "start"
          ? { x: 40, y: 0 }
          : node.kind === "question"
            ? { x: 40, y: 120 + (questionIndex.get(node.id) ?? 0) * 130 }
            : { x: 380, y: 60 + (endingIndex.get(node.id) ?? 0) * 140 };
      return {
        id: node.id,
        type: node.kind,
        position,
        data: {
          label: node.label,
          kind: node.kind,
          questionKind: node.questionKind,
          active: node.id === selectedId,
        },
      };
    });

    // Edge palette: quiet border-strong strokes for the default flow spine,
    // dashed terracotta for rule goto edges — labels are white hairline pills
    // in mono microtext. Edges touching the open scope go ultramarine (the
    // .ff-edge-active CSS above), as do edges selected on the canvas itself.
    const edges: Edge[] = graph.edges.map((edge) => {
      const isActive = selectedId !== null && (edge.source === selectedId || edge.target === selectedId);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.isRuleEdge ? edge.ruleId : undefined,
        className: isActive ? "ff-edge-active" : undefined,
        // WCAG 2.1 AA (spec §14.4): xyflow renders edges as focusable elements —
        // give them screen-reader + tab-stop labels.
        ariaLabel: edge.isRuleEdge ? `goto rule ${edge.ruleId}` : `flow from ${edge.source} to ${edge.target}`,
        style: edge.isRuleEdge
          ? { stroke: "var(--ff-accent)", strokeDasharray: "6 4", strokeWidth: 1.5 }
          : { stroke: "var(--ff-border-strong)", strokeWidth: 1.5 },
        labelStyle: {
          fontSize: 10,
          fontWeight: 500,
          fontFamily: "var(--ff-font-mono)",
          fill: edge.isRuleEdge
            ? "color-mix(in srgb, var(--ff-accent) 72%, var(--ff-fg))"
            : "var(--ff-muted)",
        },
        labelBgStyle: {
          fill: "var(--ff-card)",
          stroke: "var(--ff-border-strong)",
          strokeWidth: 1,
        },
        labelBgPadding: [5, 2],
        labelBgBorderRadius: 999,
      };
    });

    return { flowNodes: nodes, flowEdges: edges };
  }, [graph, selectedId]);

  return (
    <div className="ff-logic-flow h-full w-full" data-testid="logic-canvas">
      <style>{FLOW_CHROME_CSS}</style>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => onSelect(node.id)}
      >
        <MiniMap
          position="top-right"
          pannable={false}
          zoomable={false}
          ariaLabel="Flow mini map"
          nodeColor={miniMapNodeColor}
          nodeBorderRadius={6}
          maskColor="color-mix(in srgb, var(--ff-bg) 60%, transparent)"
          maskStrokeColor="color-mix(in srgb, var(--ff-primary) 45%, transparent)"
          maskStrokeWidth={1}
          style={{ width: 160, height: 116 }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
