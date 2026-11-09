"use client";

// Logic builder canvas (spec §14.1.4): React Flow canvas — nodes = start,
// question blocks, endings; edges = default flow (document order) + dashed
// rule goto edges. Pure presentation: the graph model comes from
// lib/logic/graph.ts (unit-tested); clicking a node opens the rule drawer.
//
// Aurora redesign (task 10/13): frosted node cards (14px radius, glass border,
// backdrop blur) with gradient type tiles, violet ring + glow on the active
// scope, violet (default-flow) / cyan (rule goto) edge strokes, --ff-primary
// handles, a token-colored dot grid, and muted glass chrome for Controls +
// MiniMap. Node data + graph mapping logic is unchanged.

import { useMemo } from "react";
import {
  Background,
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
 * Node chrome (aurora glass)
 * ------------------------------------------------------------------------ */

/* Shared node surface — frosted glass card with the glass hairline so nodes
   read as draggable objects floating over the dotted aurora canvas. */
const NODE_SURFACE =
  "border border-[var(--ff-glass-border)] bg-[var(--ff-glass)] shadow-[var(--ff-shadow-sm)] backdrop-blur-md";
/* Active scope: violet ring + violet glow (box-shadow only, no layout shift). */
const NODE_ACTIVE =
  "border-[var(--ff-primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ff-primary)_22%,transparent),var(--ff-glow)]";

const NODE_TRANSITION = "transition-[border-color,box-shadow] duration-150";

/* Gradient type tiles: violet→cyan for start/question, cyan for endings. */
const TILE_BASE =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),var(--ff-shadow-sm)]";
const TILE_VIOLET = `${TILE_BASE} text-[var(--ff-primary-fg)]`;
const TILE_CYAN = `${TILE_BASE} text-[var(--ff-accent-fg)]`;

const TILE_GRADIENT = { background: "var(--ff-grad)" } as const;
const TILE_ENDING_GRADIENT = {
  background: "linear-gradient(135deg, var(--ff-accent), var(--ff-primary-2))",
} as const;

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

/* Handles in --ff-primary with a card-colored rim so they pop off the glass. */
const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: "var(--ff-primary)",
  border: "2px solid var(--ff-card)",
  boxShadow: "0 0 0 1px color-mix(in srgb, var(--ff-primary) 35%, transparent)",
} as const;

function StartNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-[14px] px-3 py-2 ${NODE_SURFACE} ${NODE_TRANSITION} ${
        data.active ? NODE_ACTIVE : ""
      }`}
    >
      <span aria-hidden="true" className={TILE_VIOLET} style={TILE_GRADIENT}>
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 fill-current">
          <path d="M3 1.6a.8.8 0 0 1 1.22-.68l6.4 4.4a.8.8 0 0 1 0 1.36l-6.4 4.4A.8.8 0 0 1 3 10.4Z" />
        </svg>
      </span>
      <span className="pr-0.5 text-sm font-semibold tracking-tight text-[var(--ff-fg)]">
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

function QuestionNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`flex w-[220px] items-center gap-2.5 rounded-[14px] px-3 py-2.5 ${NODE_SURFACE} ${NODE_TRANSITION} ${
        data.active ? NODE_ACTIVE : ""
      }`}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <span aria-hidden="true" className={TILE_VIOLET} style={TILE_GRADIENT}>
        <Icon name={questionTileIcon(data.questionKind)} size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-[10px] font-medium uppercase leading-3 tracking-[0.08em] text-[var(--ff-accent)]">
          {data.questionKind ?? "question"}
        </span>
        <span
          className="truncate text-sm font-medium leading-tight text-[var(--ff-fg)]"
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
      className={`flex w-[200px] items-center gap-2.5 rounded-[14px] px-3 py-2.5 ${NODE_SURFACE} ${NODE_TRANSITION} ${
        data.active ? NODE_ACTIVE : ""
      }`}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <span aria-hidden="true" className={TILE_CYAN} style={TILE_ENDING_GRADIENT}>
        <Icon name="check" size={15} />
      </span>
      <span className="truncate text-sm font-medium text-[var(--ff-fg)]" title={data.label}>
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

/* Mini-map node colors — violet family for start/questions, cyan for endings. */
function miniMapNodeColor(node: FlowNode): string {
  if (node.data.kind === "ending") return "var(--ff-accent)";
  if (node.data.kind === "start") return "var(--ff-primary)";
  return "color-mix(in srgb, var(--ff-primary) 55%, var(--ff-border-strong))";
}

/*
 * Scoped restyles for React Flow chrome that exposes no className props:
 *  · selected edges → violet stroke + soft glow (rule edges stay cyan)
 *  · Controls → frosted glass cluster with violet hover + accent focus ring
 *  · MiniMap → muted glass panel to match
 * Kept in one small block (no globals.css edits allowed); all colors are
 * tokens. Animations limited to transform/box-shadow/color transitions.
 */
const FLOW_CHROME_CSS = `
.ff-logic-flow .react-flow__edge.selected .react-flow__edge-path {
  stroke: var(--ff-primary) !important;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--ff-primary) 55%, transparent));
}
.ff-logic-flow .react-flow__controls {
  border: 1px solid var(--ff-glass-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--ff-glass);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: var(--ff-shadow-md);
}
.ff-logic-flow .react-flow__controls-button {
  width: 32px;
  height: 32px;
  border: none;
  border-bottom: 1px solid var(--ff-border);
  border-radius: 0;
  background: transparent;
  color: var(--ff-muted);
  transition: background-color 150ms var(--ff-ease-out), color 150ms var(--ff-ease-out);
}
.ff-logic-flow .react-flow__controls-button:last-child { border-bottom: none; }
.ff-logic-flow .react-flow__controls-button:hover {
  background: color-mix(in srgb, var(--ff-primary) 16%, transparent);
  color: var(--ff-fg);
}
.ff-logic-flow .react-flow__controls-button:focus-visible {
  outline: 2px solid var(--ff-accent);
  outline-offset: -2px;
}
.ff-logic-flow .react-flow__controls-button svg { fill: currentColor; }
.ff-logic-flow .react-flow__minimap {
  border: 1px solid var(--ff-glass-border);
  border-radius: 12px;
  background: var(--ff-glass);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: var(--ff-shadow-md);
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

    // Edge palette: violet strokes for the default flow spine, dashed cyan
    // for rule goto edges (with a cyan rule-id label chip).
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
        ? { stroke: "var(--ff-accent)", strokeDasharray: "6 4", strokeWidth: 1.75 }
        : {
            stroke: "color-mix(in srgb, var(--ff-primary) 48%, var(--ff-border-strong))",
            strokeWidth: 1.75,
          },
      labelStyle: {
        fontSize: 11,
        fill: "var(--ff-accent-fg)",
        fontWeight: 600,
        fontFamily: "var(--ff-font-mono)",
      },
      labelBgStyle: { fill: "var(--ff-accent)" },
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
        <Background
          gap={24}
          size={1.4}
          color="color-mix(in srgb, var(--ff-primary) 26%, var(--ff-border))"
        />
        <MiniMap
          position="top-right"
          pannable={false}
          zoomable={false}
          ariaLabel="Flow mini map"
          nodeColor={miniMapNodeColor}
          nodeBorderRadius={6}
          maskColor="color-mix(in srgb, var(--ff-bg) 58%, transparent)"
          maskStrokeColor="color-mix(in srgb, var(--ff-primary) 45%, transparent)"
          maskStrokeWidth={1}
          style={{ width: 160, height: 116 }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
