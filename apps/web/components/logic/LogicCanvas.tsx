"use client";

// Logic builder canvas (spec §14.1.4): React Flow canvas — nodes = start,
// question blocks, endings; edges = default flow (document order) + dashed
// rule goto edges. Pure presentation: the graph model comes from
// lib/logic/graph.ts (unit-tested); clicking a node opens the rule drawer.
//
// Redesign (B7): token-driven node/edge colors (no hardcoded hexes), a shared
// node surface (card bg, strong hairline, 12px radius), accent active ring,
// icon ending marker (🏁 removed), and a restyled React Flow Controls cluster.
// Node data + graph mapping logic is unchanged.

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LogicGraph } from "@/lib/logic/graph";
import { Icon } from "@/components/ui/icons";

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

/* Shared node surface — warm-paper card with a stronger hairline so nodes read
   as draggable objects on the dotted canvas. */
const NODE_SURFACE =
  "bg-[var(--ff-card)] border border-[var(--ff-border-strong)] rounded-xl shadow-[var(--ff-shadow-sm)]";
/* Active scope: accent border + soft accent halo (box-shadow only, no layout shift). */
const NODE_ACTIVE =
  "border-[var(--ff-accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ff-accent)_20%,transparent)]";

const HANDLE_STYLE = {
  width: 8,
  height: 8,
  background: "var(--ff-muted)",
  border: "2px solid var(--ff-card)",
} as const;

function StartNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-[var(--ff-shadow-sm)] ${
        data.active ? NODE_ACTIVE : "border-[var(--ff-border-strong)] bg-[var(--ff-card)] text-[var(--ff-fg)]"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-current text-[var(--ff-success)]">
        <path d="M3 1.6a.8.8 0 0 1 1.22-.68l6.4 4.4a.8.8 0 0 1 0 1.36l-6.4 4.4A.8.8 0 0 1 3 10.4Z" />
      </svg>
      {data.label}
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

function QuestionNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`min-w-[180px] px-3 py-2 ${NODE_SURFACE} ${data.active ? NODE_ACTIVE : ""}`}>
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <span className="mb-1 inline-flex rounded-md bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)] px-1.5 py-px font-mono text-xs leading-4 text-[var(--ff-muted)]">
        {data.questionKind ?? "question"}
      </span>
      <div
        className="max-w-[180px] truncate text-sm font-medium text-[var(--ff-fg)]"
        title={data.label}
      >
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

function EndingNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`min-w-[160px] px-3 py-2 ${NODE_SURFACE} ${data.active ? NODE_ACTIVE : ""}`}>
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <div className="flex items-center gap-1.5">
        <Icon name="checkCircle" size={14} className="shrink-0 text-[var(--ff-success)]" />
        <span className="truncate text-sm font-medium text-[var(--ff-fg)]" title={data.label}>
          {data.label}
        </span>
      </div>
    </div>
  );
}

const NODE_TYPES = {
  start: StartNode,
  question: QuestionNode,
  ending: EndingNode,
};

/*
 * Scoped restyles for React Flow chrome that exposes no className props:
 *  · selected edges → chart color #1 (rule edges already use it)
 *  · Controls → 32px card buttons with hairline separators + hover lift
 * Kept in one small block (no globals.css edits allowed for B7); all colors
 * are tokens. Animations limited to transform/box-shadow/color transitions.
 */
const FLOW_CHROME_CSS = `
.ff-logic-flow .react-flow__edge.selected .react-flow__edge-path { stroke: var(--ff-chart-1) !important; }
.ff-logic-flow .react-flow__controls {
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--ff-card);
  box-shadow: var(--ff-shadow-sm);
}
.ff-logic-flow .react-flow__controls-button {
  width: 32px;
  height: 32px;
  border: none;
  border-bottom: 1px solid var(--ff-border);
  border-radius: 0;
  background: var(--ff-card);
  color: var(--ff-muted);
  transition: background-color 150ms var(--ff-ease-out), color 150ms var(--ff-ease-out), transform 150ms var(--ff-ease-out);
}
.ff-logic-flow .react-flow__controls-button:last-child { border-bottom: none; }
.ff-logic-flow .react-flow__controls-button:hover {
  background: color-mix(in srgb, var(--ff-fg) 5%, var(--ff-card));
  color: var(--ff-fg);
}
.ff-logic-flow .react-flow__controls-button:focus-visible {
  outline: 2px solid var(--ff-accent);
  outline-offset: -2px;
}
.ff-logic-flow .react-flow__controls-button svg { fill: currentColor; }
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

    const edges: Edge[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.isRuleEdge,
      label: edge.isRuleEdge ? edge.ruleId : undefined,
      // WCAG 2.1 AA (spec §14.4): xyflow renders edges as focusable elements —
      // give them screen-reader + tab-stop labels.
      ariaLabel: edge.isRuleEdge ? `goto rule ${edge.ruleId}` : `flow from ${edge.source} to ${edge.target}`,
      style: edge.isRuleEdge
        ? { stroke: "var(--ff-chart-1)", strokeDasharray: "6 4", strokeWidth: 1.75 }
        : { stroke: "var(--ff-border-strong)", strokeWidth: 1.75 },
      labelStyle: { fontSize: 12, fill: "var(--ff-primary-fg)", fontWeight: 500 },
      labelBgStyle: { fill: "var(--ff-primary)" },
      labelBgPadding: [6, 2],
      labelBgBorderRadius: 6,
    }));

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
        <Background gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
