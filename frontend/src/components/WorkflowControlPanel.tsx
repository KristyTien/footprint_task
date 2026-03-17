import { useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Sandbox mode ───────────────────────────────────────────────────────────────

type SandboxMode = "normal" | "delayed" | "random_fail" | "fail"

const SANDBOX_URL = "http://localhost:8001"

async function fetchSandboxMode(): Promise<SandboxMode> {
  const res = await fetch(`${SANDBOX_URL}/mode`)
  if (!res.ok) throw new Error("Sandbox unreachable")
  return ((await res.json()) as { mode: SandboxMode }).mode
}

async function postSandboxMode(mode: SandboxMode): Promise<SandboxMode> {
  const res = await fetch(`${SANDBOX_URL}/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error("Failed to set mode")
  return ((await res.json()) as { mode: SandboxMode }).mode
}

const MODE_LABELS: Record<SandboxMode, string> = {
  normal:      "Normal",
  delayed:     "Delayed",
  random_fail: "Rnd Fail",
  fail:        "Always Fail",
}

const MODE_ACTIVE: Record<SandboxMode, string> = {
  normal:      "bg-green-600 text-white border-green-600",
  delayed:     "bg-yellow-500 text-white border-yellow-500",
  random_fail: "bg-orange-500 text-white border-orange-500",
  fail:        "bg-red-600 text-white border-red-600",
}

const MODE_IDLE: Record<SandboxMode, string> = {
  normal:      "bg-white text-green-700 border-green-200 hover:bg-green-50",
  delayed:     "bg-white text-yellow-700 border-yellow-200 hover:bg-yellow-50",
  random_fail: "bg-white text-orange-700 border-orange-200 hover:bg-orange-50",
  fail:        "bg-white text-red-700 border-red-200 hover:bg-red-50",
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowSummary {
  id: string;
  name: string;
  created_at: string;
}

interface ExecutionSummary {
  id: string;
  workflow_id: string;
  status: "running" | "success" | "failed" | "paused";
  started_at: string;
}

interface Props {
  selectedExecutionId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
  onSelectExecution: (workflowId: string, executionId: string) => void;
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchWorkflows(): Promise<WorkflowSummary[]> {
  const res = await fetch("/api/workflows");
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json();
}

async function fetchExecutions(workflowId: string): Promise<ExecutionSummary[]> {
  const res = await fetch(`/api/executions?workflow_id=${workflowId}`);
  if (!res.ok) throw new Error("Failed to fetch executions");
  return res.json();
}

async function triggerExecution(id: string): Promise<{ execution_id: string }> {
  const res = await fetch(`/api/workflows/${id}/execute`, { method: "POST", body: "{}" });
  if (!res.ok) throw new Error("Failed to execute workflow");
  return res.json();
}

async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete workflow");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  success: "bg-green-500",
  failed:  "bg-red-500",
  paused:  "bg-yellow-500",
}

const STATUS_TEXT: Record<string, string> = {
  running: "text-blue-600",
  success: "text-green-600",
  failed:  "text-red-600",
  paused:  "text-yellow-600",
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkflowControlPanel({ selectedExecutionId, onSelectWorkflow, onSelectExecution }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sandboxQuery = useQuery({
    queryKey: ["sandboxMode"],
    queryFn: fetchSandboxMode,
    refetchInterval: 5000,
  });

  const sandboxMutation = useMutation({
    mutationFn: postSandboxMode,
    onSuccess: (mode) => queryClient.setQueryData(["sandboxMode"], mode),
  });

  const { data: workflows, isLoading, isError } = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const execQueries = useQueries({
    queries: (workflows ?? []).map((wf) => ({
      queryKey: ["executions", wf.id],
      queryFn: () => fetchExecutions(wf.id),
      enabled: expanded.has(wf.id),
    })),
  });

  const execsByWorkflow = new Map<string, ExecutionSummary[]>();
  (workflows ?? []).forEach((wf, i) => {
    execsByWorkflow.set(wf.id, execQueries[i]?.data ?? []);
  });

  const runMutation = useMutation({
    mutationFn: triggerExecution,
    onSuccess: (data, workflowId) => {
      setExpanded((prev) => new Set([...prev, workflowId]));
      queryClient.invalidateQueries({ queryKey: ["executions", workflowId] });
      onSelectExecution(workflowId, data.execution_id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflows"] }),
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="w-64 flex-shrink-0 flex flex-col border-r border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Workflows</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isLoading && <p className="text-xs text-slate-400 px-2 py-1">Loading...</p>}
        {isError  && <p className="text-xs text-red-400 px-2 py-1">Failed to load workflows.</p>}
        {workflows?.length === 0 && <p className="text-xs text-slate-400 px-2 py-1">No workflows yet.</p>}

        {workflows?.map((wf) => {
          const isOpen = expanded.has(wf.id);
          const execs = execsByWorkflow.get(wf.id) ?? [];

          return (
            <div key={wf.id} className="mb-1">
              {/* Workflow row */}
              <div className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-slate-50 group">
                {/* Expand toggle */}
                <button
                  onClick={() => { toggleExpand(wf.id); onSelectWorkflow(wf.id); }}
                  className="text-slate-400 hover:text-slate-600 w-4 text-xs shrink-0"
                >
                  {isOpen ? "▾" : "▸"}
                </button>

                {/* Name */}
                <span
                  onClick={() => { toggleExpand(wf.id); onSelectWorkflow(wf.id); }}
                  className="flex-1 text-sm text-slate-700 truncate cursor-pointer"
                >
                  {wf.name}
                </span>

                {/* Run button */}
                <button
                  onClick={(e) => { e.stopPropagation(); runMutation.mutate(wf.id); }}
                  className="text-xs px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-600 text-white transition-colors shrink-0"
                >
                  {runMutation.isPending && runMutation.variables === wf.id ? "…" : "▶"}
                </button>

                {/* Delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(wf.id); }}
                  className="text-xs px-1 py-0.5 rounded hover:bg-red-50 text-red-400 transition-colors shrink-0"
                >
                  🗑
                </button>
              </div>

              {/* Execution list */}
              {isOpen && (
                <div className="ml-5 border-l border-slate-200 pl-2 mt-0.5 mb-1">
                  {execs.length === 0 && (
                    <p className="text-xs text-slate-400 py-1 px-1">No executions yet</p>
                  )}
                  {execs.map((exec) => {
                    const isSelected = selectedExecutionId === exec.id;
                    return (
                      <div
                        key={exec.id}
                        onClick={() => onSelectExecution(wf.id, exec.id)}
                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs mb-0.5 ${
                          isSelected ? "bg-slate-100" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[exec.status] ?? "bg-slate-300"}`} />
                        <span className="text-slate-600 truncate flex-1">{formatTime(exec.started_at)}</span>
                        <span className={`shrink-0 ${STATUS_TEXT[exec.status] ?? "text-slate-400"}`}>
                          {exec.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sandbox mode switcher */}
      <div className="border-t border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sandbox Mode</span>
          {sandboxQuery.isError && <span className="text-[10px] text-red-400">offline</span>}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["normal", "delayed", "random_fail", "fail"] as SandboxMode[]).map((m) => {
            const isActive = sandboxQuery.data === m;
            return (
              <button
                key={m}
                onClick={() => sandboxMutation.mutate(m)}
                disabled={sandboxMutation.isPending}
                className={`text-[11px] font-medium py-1 px-2 rounded border transition-colors disabled:opacity-50 ${
                  isActive ? MODE_ACTIVE[m] : MODE_IDLE[m]
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
