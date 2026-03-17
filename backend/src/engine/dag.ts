import type { WorkflowDefinition, NodeDefinition } from '../types/workflow.js'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateDAG(workflow: WorkflowDefinition): ValidationResult {
  const errors: string[] = []
  const nodeIds = new Set(workflow.nodes.map((n) => n.id))

  // Must have exactly one start node
  const startNodes = workflow.nodes.filter((n) => n.type === 'start')
  if (startNodes.length === 0) errors.push('Workflow must have a start node')
  if (startNodes.length > 1) errors.push('Workflow must have exactly one start node')

  // Must have at least one end node
  const endNodes = workflow.nodes.filter((n) => n.type === 'end')
  if (endNodes.length === 0) errors.push('Workflow must have at least one end node')

  // All edge source/target must reference valid node ids
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references unknown source node: ${edge.source}`)
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references unknown target node: ${edge.target}`)
    }
  }

  // Cycle detection via DFS
  const cycleError = detectCycle(workflow)
  if (cycleError) errors.push(cycleError)

  return { valid: errors.length === 0, errors }
}

function detectCycle(workflow: WorkflowDefinition): string | null {
  const adjacency = new Map<string, string[]>()
  for (const node of workflow.nodes) adjacency.set(node.id, [])
  for (const edge of workflow.edges) {
    adjacency.get(edge.source)?.push(edge.target)
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const node of workflow.nodes) color.set(node.id, WHITE)

  function dfs(nodeId: string): boolean {
    color.set(nodeId, GRAY)
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (color.get(neighbor) === GRAY) return true
      if (color.get(neighbor) === WHITE && dfs(neighbor)) return true
    }
    color.set(nodeId, BLACK)
    return false
  }

  for (const node of workflow.nodes) {
    if (color.get(node.id) === WHITE) {
      if (dfs(node.id)) return 'Workflow contains a cycle'
    }
  }
  return null
}

export function topologicalSort(workflow: WorkflowDefinition): NodeDefinition[] {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const node of workflow.nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  for (const edge of workflow.edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id)
  }

  const sorted: NodeDefinition[] = []
  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]))

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const node = nodeById.get(nodeId)!
    sorted.push(node)

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  return sorted
}
