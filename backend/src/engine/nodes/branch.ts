import type { Condition } from '../../types/workflow.js'

// Traverse a nested object using dot-notation path
// e.g. "nodes.api.response.status_code" on the context object
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function evaluateCondition(
  condition: Condition,
  context: Record<string, unknown>
): boolean {
  const value = getByPath(context, condition.field)

  switch (condition.operator) {
    case 'exists':
      return value !== undefined && value !== null

    case 'equals':
      return value === condition.value

    case 'contains':
      if (typeof value === 'string' && typeof condition.value === 'string') {
        return value.includes(condition.value)
      }
      if (Array.isArray(value)) {
        return value.includes(condition.value)
      }
      return false

    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value > condition.value
        : false

    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value < condition.value
        : false

    default:
      return false
  }
}

// Returns the next_node_id of the first matching condition, or default, or null
export function evaluateBranch(
  conditions: Condition[],
  defaultNextNodeId: string | undefined,
  context: Record<string, unknown>
): string | null {
  for (const condition of conditions) {
    if (evaluateCondition(condition, context)) {
      return condition.next_node_id
    }
  }
  return defaultNextNodeId ?? null
}
