import { Hono } from 'hono'
import { store } from '../store/hybridStore.js'
import { validateDAG } from '../engine/dag.js'
import { executeWorkflow } from '../engine/executor.js'
import type { WorkflowDefinition } from '../types/workflow.js'
import type { ExecutionRecord } from '../types/execution.js'

const workflows = new Hono()

// POST /api/workflows — create
workflows.post('/', async (c) => {
  const body = await c.req.json<Partial<WorkflowDefinition>>()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const wf: WorkflowDefinition = {
    id,
    name: body.name ?? 'Untitled',
    nodes: body.nodes ?? [],
    edges: body.edges ?? [],
    created_at: now,
    updated_at: now,
  }
  await store.setWorkflow(wf)
  return c.json(wf, 201)
})

// GET /api/workflows — list
workflows.get('/', async (c) => {
  return c.json(await store.listWorkflows())
})

// GET /api/workflows/:id
workflows.get('/:id', async (c) => {
  const wf = await store.getWorkflow(c.req.param('id'))
  if (!wf) return c.json({ error: 'Not found' }, 404)
  return c.json(wf)
})

// PUT /api/workflows/:id — update
workflows.put('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await store.getWorkflow(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<Partial<WorkflowDefinition>>()
  const updated: WorkflowDefinition = {
    ...existing,
    ...body,
    id,
    updated_at: new Date().toISOString(),
  }
  await store.setWorkflow(updated)
  return c.json(updated)
})

// DELETE /api/workflows/:id
workflows.delete('/:id', async (c) => {
  const deleted = await store.deleteWorkflow(c.req.param('id'))
  if (!deleted) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

// POST /api/workflows/:id/validate
workflows.post('/:id/validate', async (c) => {
  const wf = await store.getWorkflow(c.req.param('id'))
  if (!wf) return c.json({ error: 'Not found' }, 404)
  const result = validateDAG(wf)
  return c.json(result)
})

// POST /api/workflows/:id/execute
workflows.post('/:id/execute', async (c) => {
  const wf = await store.getWorkflow(c.req.param('id'))
  if (!wf) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{ step_through?: boolean }>().catch(() => ({} as { step_through?: boolean }))
  const stepThrough = body.step_through ?? false

  // Validate before executing
  const validation = validateDAG(wf)
  if (!validation.valid) {
    return c.json({ error: 'Invalid workflow', errors: validation.errors }, 400)
  }

  const executionId = crypto.randomUUID()
  const now = new Date().toISOString()

  const exec: ExecutionRecord = {
    id: executionId,
    workflow_id: wf.id,
    status: 'running',
    node_states: Object.fromEntries(
      wf.nodes.map((n) => [
        n.id,
        { node_id: n.id, status: 'pending', attempt: 1 },
      ])
    ),
    execution_path: [],
    context: {},
    started_at: now,
  }

  await store.setExecution(exec)

  // Background execution
  setImmediate(() => {
    executeWorkflow(wf, executionId, stepThrough).catch((err) => {
      console.error('Execution error:', err)
    })
  })

  return c.json({ execution_id: executionId, status: 'running' }, 202)
})

export default workflows
