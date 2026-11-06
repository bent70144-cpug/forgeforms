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
        data.active ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-800"
      }`}
    >
      <span aria-hidden>▶</span>
      {data.label}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

function QuestionNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`min-w-[180px] rounded-xl border px-4 py-3 text-sm shadow-sm ${
        data.active
          ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300"
          : "border-slate-300 bg-white"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {data.questionKind ?? "question"}
      </div>
      <div className="mt-1 font-medium text-slate-800">{data.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

function EndingNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`min-w-[160px] rounded-xl border px-4 py-3 text-sm shadow-sm ${
        data.active
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300"
          : "border-slate-300 bg-slate-50"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
        ending
      </div>
      <div className="mt-1 font-medium text-slate-800">{data.label}</div>
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
