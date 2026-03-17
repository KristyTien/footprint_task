import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { Context } from 'hono'

// ── Mode state ────────────────────────────────────────────────────────────────

type SandboxMode = 'normal' | 'delayed' | 'random_fail' | 'fail'
let currentMode: SandboxMode = 'normal'

// ── Mode middleware ───────────────────────────────────────────────────────────

async function applyMode(c: Context): Promise<Response | null> {
  if (currentMode === 'fail') {
    return c.json({ error: 'Service unavailable' }, 503)
  } else if (currentMode === 'delayed') {
    const ms = 20000 + Math.random() * 10000 // 20–30 s
    await new Promise((r) => setTimeout(r, ms))
  } else if (currentMode === 'random_fail') {
    if (Math.random() < 0.5) {
      return c.json({ error: 'Internal server error' }, 500)
    }
  }
  return null
}

// ── Random value helpers ──────────────────────────────────────────────────────

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack']
const LAST_NAMES = ['Johnson', 'Smith', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor']

function randomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return { first_name: first, last_name: last, full_name: `${first} ${last}` }
}

function creditTier(score: number): string {
  if (score < 580) return 'Poor'
  if (score < 670) return 'Fair'
  if (score < 740) return 'Good'
  if (score < 800) return 'Very Good'
  return 'Exceptional'
}

function randomCreditScore() {
  const score = Math.floor(Math.random() * 551) + 300
  return { score, tier: creditTier(score) }
}

function randomCreditCard() {
  const digits = () => String(Math.floor(Math.random() * 9000) + 1000)
  const number = `4${String(Math.floor(Math.random() * 1000)).padStart(3, '0')} ${digits()} ${digits()} ${digits()}`
  const now = new Date()
  const year = now.getFullYear() + 1 + Math.floor(Math.random() * 5)
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')
  const expiry = `${month}/${String(year).slice(-2)}`
  const cvv = String(Math.floor(Math.random() * 900) + 100)
  return { number, expiry, cvv, type: 'Visa' }
}

function randomSSN() {
  const area = String(Math.floor(Math.random() * 900) + 100)
  const group = String(Math.floor(Math.random() * 90) + 10)
  const serial = String(Math.floor(Math.random() * 9000) + 1000)
  return { ssn: `${area}-${group}-${serial}` }
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }))

// Mode control
app.get('/mode', (c) => c.json({ mode: currentMode }))

app.post('/mode', async (c) => {
  const body = await c.req.json<{ mode?: string }>()
  const modes: SandboxMode[] = ['normal', 'delayed', 'random_fail', 'fail']
  if (!body.mode || !modes.includes(body.mode as SandboxMode)) {
    return c.json({ error: `mode must be one of: ${modes.join(', ')}` }, 400)
  }
  currentMode = body.mode as SandboxMode
  return c.json({ mode: currentMode })
})

// Data endpoints
app.get('/api/user/name', async (c) => {
  const early = await applyMode(c)
  if (early) return early
  return c.json(randomName())
})

app.get('/api/user/credit-score', async (c) => {
  const early = await applyMode(c)
  if (early) return early
  return c.json(randomCreditScore())
})

app.get('/api/user/credit-card', async (c) => {
  const early = await applyMode(c)
  if (early) return early
  return c.json(randomCreditCard())
})

app.get('/api/user/ssn', async (c) => {
  const early = await applyMode(c)
  if (early) return early
  return c.json(randomSSN())
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 8001

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Sandbox server running on http://localhost:${PORT}`)
  console.log(`  Mode: ${currentMode}`)
  console.log(`  POST /mode  { mode: 'normal' | 'delayed' | 'random_fail' | 'fail' }`)
})
