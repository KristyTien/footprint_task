import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import type { CSSProperties } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WFNode { id: string; type: string; label: string }
interface WFEdge { id: string; source: string; target: string; label?: string }
interface WorkflowDetail { id: string; name: string; nodes: WFNode[]; edges: WFEdge[] }

type NodeStatus = "pending" | "running" | "success" | "failed" | "skipped"

// ── Layout ────────────────────────────────────────────────────────────────────

const COL_W = 220
const ROW_H = 110

function computeLayout(nodes: WFNode[], edges: WFEdge[]): Map<string, { x: number; y: number }> {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]))

  for (const e of edges) {
    children.get(e.source)?.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  const level = new Map<string, number>()
  const queue: string[] = []

  for (const [id, deg] of inDegree) {
    if (deg === 0) { level.set(id, 0); queue.push(id) }
  }

  while (queue.length > 0) {
    const id = queue.shift()!
    const nextLevel = (level.get(id) ?? 0) + 1
    for (const child of children.get(id) ?? []) {
      if (!level.has(child) || level.get(child)! < nextLevel) {
        level.set(child, nextLevel)
      }
      queue.push(child)
    }
  }

  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, 0)
  }

  const countPerLevel = new Map<number, number>()
  const nodesPerLevel = new Map<number, string[]>()
  const positions = new Map<string, { x: number; y: number }>()
  const sorted = [...nodes].sort((a, b) => (level.get(a.id) ?? 0) - (level.get(b.id) ?? 0))

  for (const n of sorted) {
    const lvl = level.get(n.id) ?? 0
    const idx = countPerLevel.get(lvl) ?? 0
    positions.set(n.id, { x: lvl * COL_W, y: idx * ROW_H })
    countPerLevel.set(lvl, idx + 1)
    const list = nodesPerLevel.get(lvl) ?? []
    list.push(n.id)
    nodesPerLevel.set(lvl, list)
  }

  // Bottom-up centering: for nodes that are the sole node at their level,
  // center them vertically between their children so fan-out looks symmetric.
  for (const n of [...sorted].reverse()) {
    const lvl = level.get(n.id) ?? 0
    if ((nodesPerLevel.get(lvl) ?? []).length > 1) continue
    const nodeChildren = children.get(n.id) ?? []
    if (nodeChildren.length === 0) continue
    const childYs = nodeChildren.map((cid) => positions.get(cid)?.y ?? 0)
    const centerY = (Math.min(...childYs) + Math.max(...childYs)) / 2
    const cur = positions.get(n.id)!
    positions.set(n.id, { x: cur.x, y: centerY })
  }

  return positions
}

// ── Node style ────────────────────────────────────────────────────────────────

const TYPE_BORDER: Record<string, string> = {
  start:       "#16a34a",
  end:         "#dc2626",
  third_party: "#2563eb",
  branch:      "#ca8a04",
}

const STATUS_BG: Record<NodeStatus, string> = {
  pending: "#fff",
  running: "#eff6ff",
  success: "#f0fdf4",
  failed:  "#fef2f2",
  skipped: "#f8fafc",
}


function nodeStyle(type: string, status: NodeStatus): CSSProperties {
  const border = TYPE_BORDER[type] ?? "#94a3b8"
  return {
    background: STATUS_BG[status],
    border: `2px solid ${border}`,
    borderRadius: 8,
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchWorkflow(id: string): Promise<WorkflowDetail> {
  const res = await fetch(`/api/workflows/${id}`)
  if (!res.ok) throw new Error("Failed to fetch workflow")
  return res.json()
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  selectedId: string | null;
  executionId: string | null;
}

export default function VisPanel({ selectedId, executionId }: Props) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["workflow", selectedId],
    queryFn: () => fetchWorkflow(selectedId!),
    enabled: !!selectedId,
  })

  // Keyed by executionId so no synchronous reset is needed — old runs are simply ignored
  const [statusMap, setStatusMap] = useState<Record<string, Record<string, NodeStatus>>>({})
  const [errorMap, setErrorMap] = useState<Record<string, Record<string, string>>>({})
  const [execResult, setExecResult] = useState<Record<string, "running" | "success" | "failed">>({})

  useEffect(() => {
    if (!executionId) return
    const es = new EventSource(`/api/executions/${executionId}/stream`)

    es.addEventListener("node_update", (e) => {
      const payload = JSON.parse(e.data) as { node_id: string; status: NodeStatus; error?: string }
      setStatusMap((prev) => ({
        ...prev,
        [executionId]: { ...(prev[executionId] ?? {}), [payload.node_id]: payload.status },
      }))
      if (payload.error) {
        setErrorMap((prev) => ({
          ...prev,
          [executionId]: { ...(prev[executionId] ?? {}), [payload.node_id]: payload.error! },
        }))
      }
    })

    es.addEventListener("execution_complete", (e) => {
      const payload = JSON.parse(e.data) as { status: "success" | "failed" }
      setExecResult((prev) => ({ ...prev, [executionId]: payload.status }))
      queryClient.invalidateQueries({ queryKey: ["executions", selectedId] })
      es.close()
    })

    return () => es.close()
  }, [executionId])

  const rfNodes: Node[] = []
  const rfEdges: Edge[] = []

  const activeStatuses = executionId ? (statusMap[executionId] ?? {}) : {}
  const activeErrors = executionId ? (errorMap[executionId] ?? {}) : {}
  // Derive overall execution state — "running" until execution_complete fires
  const overallStatus: "running" | "success" | "failed" | null = executionId
    ? (execResult[executionId] ?? "running")
    : null

  const OVERALL_COLOR: Record<string, string> = {
    running: "text-blue-600",
    success: "text-green-600",
    failed:  "text-red-600",
  }

  if (data) {
    const positions = computeLayout(data.nodes, data.edges)
    for (const n of data.nodes) {
      const status: NodeStatus = executionId
        ? (activeStatuses[n.id] ?? "pending")
        : "pending"
      const err = activeErrors[n.id]
      const labelText = executionId
        ? `${n.label}\n${status}${status === "failed" && err ? `\n${err.length > 40 ? err.slice(0, 40) + "…" : err}` : ""}`
        : n.label
      rfNodes.push({
        id: n.id,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { label: labelText },
        style: { ...nodeStyle(n.type, status), whiteSpace: "pre", fontSize: 12 },
      })
    }
    for (const e of data.edges) {
      rfEdges.push({ id: e.id, source: e.source, target: e.target, label: e.label, type: "smoothstep" })
    }
  }

  const showOverlay = !selectedId || isLoading

  return (
    <div className="flex-1 relative flex flex-col">
      {/* Execution status strip */}
      {executionId && data && (
        <div className="flex items-center gap-4 px-4 py-2 bg-white border-b border-slate-200 text-xs shrink-0">
          <span className="font-medium text-slate-500 uppercase tracking-wide">Execution</span>
          <span className={`font-semibold ${OVERALL_COLOR[overallStatus!] ?? ""}`}>
            {overallStatus}
          </span>
          <span className="text-slate-300">|</span>
          {data.nodes.map((n) => {
            const st = executionId ? (activeStatuses[n.id] ?? "pending") : "pending"
            return (
              <span key={n.id} className="text-slate-500">
                <span className="text-slate-700 font-medium">{n.label}</span>
                {" · "}
                <span className={
                  st === "success" ? "text-green-600" :
                  st === "failed"  ? "text-red-600"   :
                  st === "running" ? "text-blue-600"  :
                  st === "skipped" ? "text-slate-400" :
                  "text-slate-400"
                }>
                  {st}
                </span>
                {st === "failed" && activeErrors[n.id] && (
                  <span className="text-red-400 ml-1">— {activeErrors[n.id]}</span>
                )}
              </span>
            )
          })}
        </div>
      )}

      <div className="flex-1 relative">
        <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
          <Background />
          <Controls />
        </ReactFlow>

        {showOverlay && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-400 text-sm">
              {isLoading ? "Loading…" : "Select a workflow to view execution"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
