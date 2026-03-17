import { useEffect, useState } from "react"

interface PendingAction {
  user_action_id: string
  node_id: string
  node_label: string
  error: string
  retry_count: number
}

interface CardState {
  inputJson: string
  jsonError: string | null
  submitting: boolean
}

interface ExecInfo {
  workflowName: string
  startedAt: string
}

interface Props {
  executionId: string | null
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

export default function UserActionPanel({ executionId }: Props) {
  // Map of node_id → PendingAction for all currently-failing nodes
  const [pendingActions, setPendingActions] = useState<Map<string, PendingAction>>(new Map())
  // Per-node UI state (textarea content, validation errors, loading)
  const [cardStates, setCardStates] = useState<Map<string, CardState>>(new Map())
  const [execInfo, setExecInfo] = useState<ExecInfo | null>(null)

  // Fetch workflow name + start time whenever executionId changes
  useEffect(() => {
    setExecInfo(null)
    if (!executionId) return
    ;(async () => {
      const execRes = await fetch(`/api/executions/${executionId}`)
      if (!execRes.ok) return
      const exec = await execRes.json() as { workflow_id: string; started_at: string }
      const wfRes = await fetch(`/api/workflows/${exec.workflow_id}`)
      if (!wfRes.ok) return
      const wf = await wfRes.json() as { name: string }
      setExecInfo({ workflowName: wf.name, startedAt: exec.started_at })
    })()
  }, [executionId])

  // Reset and subscribe whenever executionId changes
  useEffect(() => {
    setPendingActions(new Map())
    setCardStates(new Map())

    if (!executionId) return

    const es = new EventSource(`/api/executions/${executionId}/stream`)

    es.addEventListener("user_action_required", (e) => {
      const payload = JSON.parse(e.data) as PendingAction
      setPendingActions((prev) => {
        const next = new Map(prev)
        next.set(payload.node_id, payload)
        return next
      })
      // Reset card state for this node on each new action (e.g. after retry fails again)
      setCardStates((prev) => {
        const next = new Map(prev)
        next.set(payload.node_id, { inputJson: "", jsonError: null, submitting: false })
        return next
      })
    })

    es.addEventListener("node_update", (e) => {
      const payload = JSON.parse(e.data) as { node_id: string; status: string }
      // When a node starts running (e.g. retry in progress), remove it from the panel
      if (payload.status === "running") {
        setPendingActions((prev) => {
          const next = new Map(prev)
          next.delete(payload.node_id)
          return next
        })
      }
    })

    es.addEventListener("execution_complete", () => {
      setPendingActions(new Map())
      es.close()
    })

    return () => es.close()
  }, [executionId])

  function updateCard(nodeId: string, patch: Partial<CardState>) {
    setCardStates((prev) => {
      const next = new Map(prev)
      const existing = next.get(nodeId) ?? { inputJson: "", jsonError: null, submitting: false }
      next.set(nodeId, { ...existing, ...patch })
      return next
    })
  }

  async function handleRetry(nodeId: string) {
    if (!executionId) return
    updateCard(nodeId, { submitting: true })
    try {
      await fetch(`/api/executions/${executionId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId }),
      })
      // Panel card clears via node_update → running SSE event
    } finally {
      updateCard(nodeId, { submitting: false })
    }
  }

  async function handleInput(nodeId: string) {
    if (!executionId) return
    const card = cardStates.get(nodeId) ?? { inputJson: "", jsonError: null, submitting: false }
    updateCard(nodeId, { jsonError: null })

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(card.inputJson)
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        throw new Error("Must be a JSON object")
      }
    } catch (err) {
      updateCard(nodeId, { jsonError: err instanceof Error ? err.message : "Invalid JSON" })
      return
    }

    updateCard(nodeId, { submitting: true })
    try {
      const res = await fetch(`/api/executions/${executionId}/user-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId, data: parsed }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        updateCard(nodeId, { jsonError: body.error ?? "Request failed", submitting: false })
      } else {
        setPendingActions((prev) => {
          const next = new Map(prev)
          next.delete(nodeId)
          return next
        })
      }
    } finally {
      updateCard(nodeId, { submitting: false })
    }
  }

  const actions = [...pendingActions.values()]

  return (
    <div className="w-80 flex-shrink-0 flex flex-col border-l border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            User Actions
          </h2>
          {actions.length > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
              {actions.length}
            </span>
          )}
        </div>
        {execInfo && (
          <div className="mt-1 flex flex-col gap-0.5">
            <span className="text-xs font-medium text-slate-600 truncate">{execInfo.workflowName}</span>
            <span className="text-[11px] text-slate-400">Started {formatTime(execInfo.startedAt)}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!executionId && (
          <p className="text-xs text-slate-400 px-4 py-4">No active execution.</p>
        )}

        {executionId && actions.length === 0 && (
          <p className="text-xs text-slate-400 px-4 py-4">No action required.</p>
        )}

        {actions.map((action, i) => {
          const card = cardStates.get(action.node_id) ?? { inputJson: "", jsonError: null, submitting: false }
          return (
            <div
              key={action.node_id}
              className={`px-4 py-4 flex flex-col gap-3 ${i < actions.length - 1 ? "border-b border-slate-100" : ""}`}
            >
              {/* Node label + error badge */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-slate-700 truncate">{action.node_label}</span>
                </div>
                {action.retry_count > 0 && (
                  <p className="text-xs text-amber-600 mb-1">
                    Retry attempt {action.retry_count} also failed
                  </p>
                )}
                <p className="text-xs text-red-600 font-mono break-all bg-red-50 rounded px-2 py-1.5 border border-red-100">
                  {action.error}
                </p>
              </div>

              {/* Retry */}
              <button
                onClick={() => handleRetry(action.node_id)}
                disabled={card.submitting}
                className="w-full py-1.5 px-3 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
              >
                {card.submitting ? "Working…" : "Retry"}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400">or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* JSON input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Provide output as JSON</label>
                <textarea
                  value={card.inputJson}
                  onChange={(e) => updateCard(action.node_id, { inputJson: e.target.value, jsonError: null })}
                  placeholder={'{\n  "status_code": 200,\n  "body": {}\n}'}
                  rows={4}
                  className="w-full text-xs font-mono border border-slate-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {card.jsonError && (
                  <p className="text-xs text-red-500">{card.jsonError}</p>
                )}
                <button
                  onClick={() => handleInput(action.node_id)}
                  disabled={card.submitting || card.inputJson.trim() === ""}
                  className="w-full py-1.5 px-3 rounded bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium"
                >
                  {card.submitting ? "Working…" : "Submit Input"}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
