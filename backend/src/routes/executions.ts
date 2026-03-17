import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { store } from '../store/hybridStore.js'

const executions = new Hono()

// GET /api/executions?workflow_id=:wfId
executions.get('/', async (c) => {
  const workflowId = c.req.query('workflow_id')
  if (!workflowId) return c.json({ error: 'workflow_id query param required' }, 400)
  return c.json(await store.listExecutionsByWorkflow(workflowId))
})

// GET /api/executions/:id
executions.get('/:id', async (c) => {
  const exec = await store.getExecution(c.req.param('id'))
  if (!exec) return c.json({ error: 'Not found' }, 404)
  return c.json(exec)
})

// GET /api/executions/:id/stream — SSE
executions.get('/:id/stream', async (c) => {
  const id = c.req.param('id')
  const exec = await store.getExecution(id)
  if (!exec) return c.json({ error: 'Not found' }, 404)

  return streamSSE(c, async (stream) => {
    const queue = store.subscribe(id)

    try {
      while (true) {
        const event = await queue.get()

        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        })

        if (event.type === 'execution_complete') {
          break
        }
      }
    } finally {
      store.unsubscribe(id, queue)
    }
  })
})

// POST /api/executions/:id/step — advance step-through
executions.post('/:id/step', async (c) => {
  const id = c.req.param('id')
  const exec = await store.getExecution(id)
  if (!exec) return c.json({ error: 'Not found' }, 404)

  const signaled = store.signalStep(id)
  if (!signaled) {
    return c.json({ error: 'No step pending' }, 409)
  }

  return c.json({ ok: true })
})

// GET /api/executions/:id/user-action — fetch all pending user actions
executions.get('/:id/user-action', async (c) => {
  const id = c.req.param('id')
  const exec = await store.getExecution(id)
  if (!exec) return c.json({ error: 'Not found' }, 404)
  const actions = await store.getActiveUserActions(id)
  return c.json(actions)
})

// POST /api/executions/:id/retry — retry a specific failed node
// Body: { node_id: string }
executions.post('/:id/retry', async (c) => {
  const id = c.req.param('id')
  const exec = await store.getExecution(id)
  if (!exec) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{ node_id: string }>()
  if (!body?.node_id) return c.json({ error: 'node_id required' }, 400)

  const signaled = store.signalUserAction(id, body.node_id, 'retry')
  if (!signaled) {
    return c.json({ error: 'No pending user action for that node' }, 409)
  }

  return c.json({ ok: true })
})

// POST /api/executions/:id/user-input — provide JSON input for a specific failed node
// Body: { node_id: string, data: {...} }
executions.post('/:id/user-input', async (c) => {
  const id = c.req.param('id')
  const exec = await store.getExecution(id)
  if (!exec) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{ node_id: string; data: Record<string, unknown> }>()
  if (!body?.node_id) return c.json({ error: 'node_id required' }, 400)
  if (!body?.data || typeof body.data !== 'object') {
    return c.json({ error: 'data must be an object' }, 400)
  }

  const signaled = store.signalUserAction(id, body.node_id, 'input', body.data)
  if (!signaled) {
    return c.json({ error: 'No pending user action for that node' }, 409)
  }

  return c.json({ ok: true })
})

export default executions
