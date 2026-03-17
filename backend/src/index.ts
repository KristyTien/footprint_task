import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import workflowRoutes from './routes/workflows.js'
import executionRoutes from './routes/executions.js'
import nodeRoutes from './routes/nodes.js'
import { store } from './store/hybridStore.js'
import './firebase.js'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: 'http://localhost:5173',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
)

app.get('/health', (c) => c.json({ status: 'ok' }))

app.get('/api/hello', (c) => c.json({ message: 'Hello, World!' }))

// Server config
app.get('/api/config', (c) => c.json({ sandbox: store.getSandbox() }))
app.post('/api/config/sandbox/toggle', (c) => c.json({ sandbox: store.toggleSandbox() }))

app.route('/api/workflows', workflowRoutes)
app.route('/api/executions', executionRoutes)
app.route('/api/nodes', nodeRoutes)

const PORT = 8000

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Footprint backend running on http://localhost:${PORT}`)
})
