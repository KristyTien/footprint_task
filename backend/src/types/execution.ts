export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface NodeExecutionState {
  node_id: string
  status: NodeStatus
  started_at?: string
  completed_at?: string
  output?: Record<string, unknown>
  error?: string
  attempt: number
}

export interface ExecutionRecord {
  id: string
  workflow_id: string
  status: 'running' | 'success' | 'failed' | 'paused' | 'pending_user_input'
  node_states: Record<string, NodeExecutionState>
  execution_path: string[]
  context: Record<string, unknown>
  started_at: string
  completed_at?: string
  error?: string
}

export interface SSEEvent {
  type: 'node_update' | 'execution_complete' | 'user_action_required'
  data: Record<string, unknown>
}

export interface UserAction {
  id: string
  execution_id: string
  node_id: string
  node_label: string
  error: string
  status: 'pending' | 'resolved'
  action_taken?: 'retry' | 'input'
  input_data?: Record<string, unknown>
  retry_count: number
  created_at: string
  updated_at: string
}
