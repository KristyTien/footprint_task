import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../firebase.js'
import type { WorkflowDefinition, NodeDefinition } from '../types/workflow.js'
import type { ExecutionRecord, SSEEvent, UserAction } from '../types/execution.js'

export class AsyncQueue<T> {
  private items: T[] = []
  private waiters: ((v: T) => void)[] = []

  put(item: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(item)
    } else {
      this.items.push(item)
    }
  }

  get(): Promise<T> {
    const item = this.items.shift()
    if (item !== undefined) {
      return Promise.resolve(item)
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve)
    })
  }
}

class HybridStore {
  private sseQueues = new Map<string, AsyncQueue<SSEEvent>[]>()
  private sseReplayBuffers = new Map<string, SSEEvent[]>()
  private stepResolvers = new Map<string, (() => void)[]>()
  private userActionResolvers = new Map<string, ((r: { type: 'retry' | 'input'; data?: Record<string, unknown> }) => void)[]>()
  private sandboxMode = false

  // Sandbox mode (in-memory)
  getSandbox(): boolean {
    return this.sandboxMode
  }

  toggleSandbox(): boolean {
    this.sandboxMode = !this.sandboxMode
    return this.sandboxMode
  }

  // Workflow CRUD — Firestore
  async setWorkflow(wf: WorkflowDefinition): Promise<void> {
    // Save each node to the nodes collection (source of truth)
    await Promise.all(wf.nodes.map((n) => setDoc(doc(db, 'nodes', n.id), n)))
    // Store workflow with node_ids only — no embedded node configs
    const { nodes, ...rest } = wf
    await setDoc(doc(db, 'workflows', wf.id), { ...rest, node_ids: nodes.map((n) => n.id) })
  }

  async getWorkflow(id: string): Promise<WorkflowDefinition | undefined> {
    const snap = await getDoc(doc(db, 'workflows', id))
    if (!snap.exists()) return undefined
    const data = snap.data() as WorkflowDefinition & { node_ids?: string[] }

    // New format: resolve node references from the nodes collection
    if (data.node_ids) {
      const nodeSnaps = await Promise.all(
        data.node_ids.map((nid) => getDoc(doc(db, 'nodes', nid)))
      )
      const nodes = nodeSnaps
        .filter((s) => s.exists())
        .map((s) => s.data() as NodeDefinition)
      const { node_ids, ...rest } = data as WorkflowDefinition & { node_ids: string[] }
      return { ...rest, nodes }
    }

    // Legacy format: embedded nodes (backward compat)
    return data
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const snap = await getDocs(collection(db, 'workflows'))
    // Return slim records — nodes are resolved on demand via getWorkflow
    return snap.docs.map((d) => {
      const data = d.data() as WorkflowDefinition & { node_ids?: string[] }
      return { ...data, nodes: data.nodes ?? [] }
    })
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const snap = await getDoc(doc(db, 'workflows', id))
    if (!snap.exists()) return false
    await deleteDoc(doc(db, 'workflows', id))
    return true
  }

  // Node CRUD — Firestore
  async setNode(node: NodeDefinition): Promise<void> {
    await setDoc(doc(db, 'nodes', node.id), node)
  }

  async getNode(id: string): Promise<NodeDefinition | undefined> {
    const snap = await getDoc(doc(db, 'nodes', id))
    return snap.exists() ? (snap.data() as NodeDefinition) : undefined
  }

  async listNodes(): Promise<NodeDefinition[]> {
    const snap = await getDocs(collection(db, 'nodes'))
    return snap.docs.map((d) => d.data() as NodeDefinition)
  }

  async deleteNode(id: string): Promise<boolean> {
    const snap = await getDoc(doc(db, 'nodes', id))
    if (!snap.exists()) return false
    await deleteDoc(doc(db, 'nodes', id))
    return true
  }

  // Execution CRUD — Firestore
  async setExecution(exec: ExecutionRecord): Promise<void> {
    await setDoc(doc(db, 'executions', exec.id), exec)
  }

  async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    const snap = await getDoc(doc(db, 'executions', id))
    return snap.exists() ? (snap.data() as ExecutionRecord) : undefined
  }

  async listExecutionsByWorkflow(workflowId: string): Promise<ExecutionRecord[]> {
    const q = query(collection(db, 'executions'), where('workflow_id', '==', workflowId))
    const snap = await getDocs(q)
    const records = snap.docs.map((d) => d.data() as ExecutionRecord)
    return records.sort((a, b) => b.started_at.localeCompare(a.started_at))
  }

  // SSE pub/sub (in-memory)
  subscribe(executionId: string): AsyncQueue<SSEEvent> {
    const queue = new AsyncQueue<SSEEvent>()
    const replay = this.sseReplayBuffers.get(executionId) ?? []
    for (const event of replay) {
      queue.put(event)
    }
    const queues = this.sseQueues.get(executionId) ?? []
    queues.push(queue)
    this.sseQueues.set(executionId, queues)
    return queue
  }

  unsubscribe(executionId: string, queue: AsyncQueue<SSEEvent>): void {
    const queues = this.sseQueues.get(executionId)
    if (!queues) return
    const idx = queues.indexOf(queue)
    if (idx !== -1) queues.splice(idx, 1)
  }

  emitEvent(executionId: string, event: SSEEvent): void {
    const replay = this.sseReplayBuffers.get(executionId) ?? []
    replay.push(event)
    this.sseReplayBuffers.set(executionId, replay)
    const queues = this.sseQueues.get(executionId) ?? []
    for (const q of queues) {
      q.put(event)
    }
  }

  // Step-through (in-memory)
  waitForStep(executionId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const resolvers = this.stepResolvers.get(executionId) ?? []
      resolvers.push(resolve)
      this.stepResolvers.set(executionId, resolvers)
    })
  }

  signalStep(executionId: string): boolean {
    const resolvers = this.stepResolvers.get(executionId)
    if (!resolvers || resolvers.length === 0) return false
    const resolve = resolvers.shift()!
    resolve()
    return true
  }

  // UserAction CRUD — Firestore
  async setUserAction(ua: UserAction): Promise<void> {
    await setDoc(doc(db, 'user_actions', ua.id), ua)
  }

  async getActiveUserActions(executionId: string): Promise<UserAction[]> {
    const q = query(
      collection(db, 'user_actions'),
      where('execution_id', '==', executionId),
      where('status', '==', 'pending')
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data() as UserAction)
  }

  // User-action signal/wait — keyed by `${executionId}:${nodeId}` so parallel
  // failing nodes each get their own resolver and can be acted on independently.
  waitForUserAction(
    executionId: string,
    nodeId: string
  ): Promise<{ type: 'retry' | 'input'; data?: Record<string, unknown> }> {
    const key = `${executionId}:${nodeId}`
    return new Promise((resolve) => {
      const resolvers = this.userActionResolvers.get(key) ?? []
      resolvers.push(resolve)
      this.userActionResolvers.set(key, resolvers)
    })
  }

  signalUserAction(
    executionId: string,
    nodeId: string,
    type: 'retry' | 'input',
    data?: Record<string, unknown>
  ): boolean {
    const key = `${executionId}:${nodeId}`
    const resolvers = this.userActionResolvers.get(key)
    if (!resolvers || resolvers.length === 0) return false
    const resolve = resolvers.shift()!
    resolve({ type, data })
    return true
  }

  // Patch top-level execution fields (status, completed_at, etc.) without
  // touching node_states — safe to call after atomic updateNodeState writes.
  async patchExecution(executionId: string, patch: Record<string, unknown>): Promise<void> {
    await updateDoc(doc(db, 'executions', executionId), patch)
  }

  // Atomic node-state patch — safe for concurrent parallel node writes.
  // Uses Firestore field-path updates so concurrent writes to different nodeIds
  // don't overwrite each other.
  async updateNodeState(
    executionId: string,
    nodeId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const fields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      fields[`node_states.${nodeId}.${k}`] = v
    }
    await updateDoc(doc(db, 'executions', executionId), fields)
  }

  // Atomic append to execution_path — safe for concurrent parallel node writes.
  async appendExecutionPath(executionId: string, nodeId: string): Promise<void> {
    await updateDoc(doc(db, 'executions', executionId), {
      execution_path: arrayUnion(nodeId),
    })
  }
}

export const store = new HybridStore()
