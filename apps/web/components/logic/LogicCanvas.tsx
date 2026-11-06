"use client";

// Logic builder canvas (spec §14.1.4): React Flow canvas — nodes = start,
// question blocks, endings; edges = default flow (document order) + dashed
// rule goto edges. Pure presentation: the graph model comes from
// lib/logic/graph.ts (unit-tested); clicking a node opens the rule drawer.

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

function StartNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-sm ${
        data.active
          ? "border-[var(--ff-primary)] bg-[var(--ff-primary)] text-[var(--ff-primary-fg)]"
          : "border-[var(--ff-border)] bg-[var(--ff-card)] text-[var(--ff-fg)]"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-current">
        <path d="M3 1.6a.8.8 0 0 1 1.22-.68l6.4 4.4a.8.8 0 0 1 0 1.36l-6.4 4.4A.8.8 0 0 1 3 10.4Z" />
      </svg>
      {data.label}
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--ff-muted)]" />
    </div>
  );
}

function QuestionNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`min-w-[180px] rounded-[var(--ff-radius)] border px-4 py-3 text-sm shadow-sm ${
        data.active
          ? "border-[var(--ff-primary)] bg-[color-mix(in_srgb,var(--ff-primary)_10%,var(--ff-card))] ring-2 ring-[color-mix(in_srgb,var(--ff-primary)_40%,transparent)]"
          : "border-[var(--ff-border)] bg-[var(--ff-card)]"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--ff-muted)]" />
      <div className="text-[11px] font-medium text-[var(--ff-muted)]">
        {data.questionKind ?? "question"}
      </div>
      <div className="mt-1 font-medium text-[var(--ff-fg)]">{data.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--ff-muted)]" />
    </div>
  );
}

function EndingNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`min-w-[160px] rounded-[var(--ff-radius)] border px-4 py-3 text-sm shadow-sm ${
        data.active
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300 dark:border-emerald-400 dark:bg-emerald-500/10 dark:ring-emerald-500/40"
          : "border-[var(--ff-border)] bg-[var(--ff-bg)]"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--ff-muted)]" />
      <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        ending
      </div>
      <div className="mt-1 font-medium text-[var(--ff-fg)]">{data.label}</div>
    </div>
  );
}

const NODE_TYPES = {
  start: StartNode,
  question: QuestionNode,
  ending: EndingNode,
};

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
        ? { stroke: "#6366f1", strokeDasharray: "6 4", strokeWidth: 2 }
        : { stroke: "#94a3b8", strokeWidth: 2 },
      labelStyle: { fontSize: 11, fill: "#4f46e5" },
    }));

    return { flowNodes: nodes, flowEdges: edges };
  }, [graph, selectedId]);

  return (
    <div className="h-full w-full" data-testid="logic-canvas">
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
