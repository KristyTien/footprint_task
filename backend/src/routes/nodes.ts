import { Hono } from 'hono'
import { store } from '../store/hybridStore.js'
import type { NodeDefinition } from '../types/workflow.js'

const nodes = new Hono()

// POST /api/nodes — create
nodes.post('/', async (c) => {
  const body = await c.req.json<Partial<NodeDefinition>>()
  const node: NodeDefinition = {
    id: crypto.randomUUID(),
    type: body.type ?? 'third_party',
    label: body.label ?? 'Untitled Node',
    ...(body.config ? { config: body.config } : {}),
  }
  await store.setNode(node)
  return c.json(node, 201)
})

// GET /api/nodes — list all
nodes.get('/', async (c) => {
  return c.json(await store.listNodes())
})

// GET /api/nodes/:id
nodes.get('/:id', async (c) => {
  const node = await store.getNode(c.req.param('id'))
  if (!node) return c.json({ error: 'Not found' }, 404)
  return c.json(node)
})

// PUT /api/nodes/:id — update
nodes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await store.getNode(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<Partial<NodeDefinition>>()
  const updated: NodeDefinition = { ...existing, ...body, id }
  await store.setNode(updated)
  return c.json(updated)
})

// DELETE /api/nodes/:id
nodes.delete('/:id', async (c) => {
  const deleted = await store.deleteNode(c.req.param('id'))
  if (!deleted) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export default nodes
