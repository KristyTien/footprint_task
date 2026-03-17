import { randomUUID } from 'crypto'
import { store } from '../store/hybridStore.js'
import { ThirdPartyRunner } from './nodes/thirdParty.js'
import { evaluateBranch } from './nodes/branch.js'
import { isBranchConfig } from '../types/workflow.js'
import type { WorkflowDefinition } from '../types/workflow.js'
import type { ExecutionRecord, NodeExecutionState, UserAction } from '../types/execution.js'

const thirdPartyRunner = new ThirdPartyRunner()

function now(): string {
  return new Date().toISOString()
}

// Store node output in context both nested and flat-aliased
function storeOutput(
  context: Record<string, unknown>,
  nodeId: string,
  output: Record<string, unknown>
): void {
  // Nested: context.nodes.<id>.response
  if (!context['nodes']) context['nodes'] = {}
  const nodes = context['nodes'] as Record<string, unknown>
  nodes[nodeId] = { response: output }

  // Flat alias: context["nodes.<id>.response"] = output
  context[`nodes.${nodeId}.response`] = output

  // Also alias each top-level key in output
  for (const [k, v] of Object.entries(output)) {
    context[`nodes.${nodeId}.response.${k}`] = v
  }
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  executionId: string,
  stepThrough: boolean
): Promise<void> {
  const exec = (await store.getExecution(executionId))!
  const context = exec.context

  // Build adjacency for BFS
  const adjacency = new Map<string, string[]>()
  for (const node of workflow.nodes) adjacency.set(node.id, [])
  for (const edge of workflow.edges) {
    adjacency.get(edge.source)?.push(edge.target)
  }

  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]))

  // BFS from start node
  const startNode = workflow.nodes.find((n) => n.type === 'start')
  if (!startNode) {
    await finalizeExecution(executionId, 'failed', 'No start node found')
    return
  }

  // Track which nodes have been visited and completed
  const visited = new Set<string>()
  const completed = new Set<string>()

  // In-degree tracking for BFS: a node is ready when all its predecessors are done
  const inDegree = new Map<string, number>()
  for (const node of workflow.nodes) inDegree.set(node.id, 0)
  for (const edge of workflow.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue: string[] = [startNode.id]
  visited.add(startNode.id)

  // Track which targets are "reachable" — branch nodes prune non-matching targets
  const pruned = new Set<string>()

  function enqueueTargets(nodeId: string) {
    for (const target of adjacency.get(nodeId) ?? []) {
      if (!visited.has(target)) { visited.add(target); queue.push(target) }
    }
  }

  try {
    while (queue.length > 0) {
      // Collect all nodes at current "level" that are ready (in-degree satisfied)
      const readyBatch: string[] = []
      const remaining: string[] = []

      for (const nodeId of queue) {
        const allPredsDone =
          workflow.edges
            .filter((e) => e.target === nodeId)
            .every((e) => completed.has(e.source) || pruned.has(e.source))

        if (allPredsDone || nodeId === startNode.id) {
          readyBatch.push(nodeId)
        } else {
          remaining.push(nodeId)
        }
      }

      // If no nodes are ready but queue is non-empty, just process the first one
      // (handles linear chains)
      const batch = readyBatch.length > 0 ? readyBatch : [queue[0]]
      const newQueue = readyBatch.length > 0 ? remaining : queue.slice(1)
      queue.length = 0
      queue.push(...newQueue)

      // Step-through pause before each batch
      if (stepThrough) {
        await updateExecution(executionId, { status: 'paused' })
        await store.waitForStep(executionId)
        await updateExecution(executionId, { status: 'running' })
      }
      // Execute batch nodes in parallel
      await Promise.all(
        batch.map(async (nodeId) => {
          const node = nodeById.get(nodeId)!

          if (pruned.has(nodeId)) {
            await markNodeState(executionId, nodeId, 'skipped')
            store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'skipped' } })
            console.log(`[Executor] ${nodeId} — skipped`)
            completed.add(nodeId)
            return
          }

          // Mark running
          await markNodeState(executionId, nodeId, 'running', { started_at: now() })
          store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'running' } })
          console.log(`[Executor] ${nodeId} → running`)

          let output: Record<string, unknown> = {}
          let error: string | undefined

          try {
            if (node.type === 'start' || node.type === 'end') {
              output = {}
            } else if (node.type === 'third_party') {
              const result = await thirdPartyRunner.run(node, context, false)
              output = result.output
              error = result.error
            } else if (node.type === 'branch') {
              // Branch nodes don't produce output themselves — they route
              output = {}
            }
          } catch (err) {
            error = err instanceof Error ? err.message : String(err)
          }

          if (error) {
            await markNodeState(executionId, nodeId, 'failed', { completed_at: now(), error })
            store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'failed', error } })
            console.log(`[Executor] ${nodeId} ✗ failed: ${error}`)

            // User-action loop: pause until user retries or provides input
            let retryCount = 0
            let nodeHandled = false
            let currentError = error

            while (!nodeHandled) {
              const ua: UserAction = {
                id: randomUUID(),
                execution_id: executionId,
                node_id: nodeId,
                node_label: node.label,
                error: currentError,
                status: 'pending',
                retry_count: retryCount,
                created_at: now(),
                updated_at: now(),
              }
              await store.setUserAction(ua)
              await updateExecution(executionId, { status: 'pending_user_input' })
              store.emitEvent(executionId, {
                type: 'user_action_required',
                data: { user_action_id: ua.id, node_id: nodeId, node_label: node.label, error: currentError, retry_count: retryCount },
              })
              console.log(`[Executor] ${nodeId} — pending user input (retry_count=${retryCount})`)

              const { type: actionType, data: actionData } = await store.waitForUserAction(executionId, nodeId)

              if (actionType === 'input') {
                const out = actionData ?? {}
                storeOutput(context, nodeId, out)
                await markNodeState(executionId, nodeId, 'success', { completed_at: now(), output: out })
                store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'success', output: out } })
                console.log(`[Executor] ${nodeId} ✓ success (user input)`)
                completed.add(nodeId)
                enqueueTargets(nodeId)
                await store.setUserAction({ ...ua, status: 'resolved', action_taken: 'input', input_data: actionData, updated_at: now() })
                await updateExecution(executionId, { status: 'running' })
                nodeHandled = true
              } else {
                // retry
                retryCount++
                await updateExecution(executionId, { status: 'running' })
                await markNodeState(executionId, nodeId, 'running', { started_at: now() })
                store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'running' } })
                console.log(`[Executor] ${nodeId} — retrying (attempt ${retryCount})`)

                const r = await thirdPartyRunner.run(node, context, false)
                if (!r.error) {
                  storeOutput(context, nodeId, r.output)
                  await markNodeState(executionId, nodeId, 'success', { completed_at: now(), output: r.output })
                  store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'success', output: r.output } })
                  console.log(`[Executor] ${nodeId} ✓ success (retry)`)
                  completed.add(nodeId)
                  enqueueTargets(nodeId)
                  await store.setUserAction({ ...ua, status: 'resolved', action_taken: 'retry', updated_at: now() })
                  await updateExecution(executionId, { status: 'running' })
                  nodeHandled = true
                } else {
                  currentError = r.error
                  await store.setUserAction({ ...ua, status: 'resolved', action_taken: 'retry', updated_at: now() })
                  await markNodeState(executionId, nodeId, 'failed', { completed_at: now(), error: currentError })
                  store.emitEvent(executionId, { type: 'node_update', data: { node_id: nodeId, status: 'failed', error: currentError } })
                  console.log(`[Executor] ${nodeId} ✗ retry failed: ${currentError}`)
                  // loop — new user action will be created
                }
              }
            }
            return // exit batch callback; queue already populated
          }

          // Store output in context
          storeOutput(context, nodeId, output)

          await markNodeState(executionId, nodeId, 'success', {
            completed_at: now(),
            output,
          })
          console.log(`[Executor] ${nodeId} ✓ success`)
          completed.add(nodeId)

          // Append to execution_path (atomic arrayUnion — safe for parallel nodes)
          await store.appendExecutionPath(executionId, nodeId)

          // Emit SSE node_update
          store.emitEvent(executionId, {
            type: 'node_update',
            data: {
              node_id: nodeId,
              status: 'success',
              output,
            },
          })

          // Determine next nodes
          if (node.type === 'branch' && isBranchConfig(node.config)) {
            const nextId = evaluateBranch(
              node.config.conditions,
              node.config.default_next_node_id,
              context
            )

            const allTargets = adjacency.get(nodeId) ?? []
            for (const target of allTargets) {
              if (target !== nextId) {
                pruned.add(target)
                await markNodeState(executionId, target, 'skipped')
                store.emitEvent(executionId, { type: 'node_update', data: { node_id: target, status: 'skipped' } })
              }
            }

            if (nextId && !visited.has(nextId)) {
              visited.add(nextId)
              queue.push(nextId)
            }
          } else {
            // Enqueue all outgoing targets
            enqueueTargets(nodeId)
          }
        })
      )
    }

    await finalizeExecution(executionId, 'success')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await finalizeExecution(executionId, 'failed', msg)
  }
}

async function updateExecution(
  executionId: string,
  patch: Partial<ExecutionRecord>
): Promise<void> {
  await store.patchExecution(executionId, patch as Record<string, unknown>)
}

async function markNodeState(
  executionId: string,
  nodeId: string,
  status: NodeExecutionState['status'],
  extra: Partial<NodeExecutionState> = {}
): Promise<void> {
  await store.updateNodeState(executionId, nodeId, {
    node_id: nodeId,
    status,
    attempt: 1,
    ...extra,
  })
}

async function finalizeExecution(
  executionId: string,
  status: 'success' | 'failed',
  error?: string
): Promise<void> {
  await updateExecution(executionId, {
    status,
    completed_at: now(),
    ...(error ? { error } : {}),
  })

  store.emitEvent(executionId, {
    type: 'execution_complete',
    data: { status, error },
  })
}
