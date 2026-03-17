import type { NodeDefinition } from '../../types/workflow.js'

export interface NodeRunResult {
  output: Record<string, unknown>
  error?: string
}

export abstract class NodeRunner {
  abstract run(
    node: NodeDefinition,
    context: Record<string, unknown>
  ): Promise<NodeRunResult>
}
