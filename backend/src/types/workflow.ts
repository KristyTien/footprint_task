export type NodeType = 'start' | 'end' | 'third_party' | 'branch'

export interface RetryConfig {
  max_attempts: number
  backoff_base_seconds: number
}

export interface ThirdPartyConfig {
  url: string
  method: string
  headers: Record<string, string>
  body?: Record<string, unknown>
  timeout_seconds: number
  retry: RetryConfig
}

export interface Condition {
  field: string
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'exists'
  value?: unknown
  next_node_id: string
}

export interface BranchConfig {
  conditions: Condition[]
  default_next_node_id?: string
}

export interface NodeDefinition {
  id: string
  type: NodeType
  label: string
  config?: ThirdPartyConfig | BranchConfig
}

export interface Edge {
  id: string
  source: string
  target: string
  label?: string
}

export interface WorkflowDefinition {
  id: string
  name: string
  nodes: NodeDefinition[]
  edges: Edge[]
  created_at: string
  updated_at: string
}

// Type guards
export function isThirdPartyConfig(config: unknown): config is ThirdPartyConfig {
  return typeof config === 'object' && config !== null && 'url' in config
}

export function isBranchConfig(config: unknown): config is BranchConfig {
  return typeof config === 'object' && config !== null && 'conditions' in config
}
