# Footprint Interview Project: DAG Workflow Engine

Full-stack DAG workflow engine for defining, validating, executing, and visualizing workflows composed of third-party API calls and branch conditions.

## What This Implements

- DAG execution engine with node types:
  - `start`
  - `end`
  - `third_party` (HTTP request node)
  - `branch` (conditional routing node)
- Validation before execution:
  - exactly one start node
  - at least one end node
  - no cycles
  - edges reference valid nodes
- Fault tolerance:
  - per-node retry with exponential backoff
  - timeout handling for external calls
  - node-level error states (workflow does not crash silently)
- Debug / sandbox tooling:
  - step-through execution mode
  - separate sandbox API with controllable failure/delay modes
- Execution visibility:
  - SSE stream for node state transitions and completion
  - DAG UI with live status coloring and execution path feedback
- Human-in-the-loop recovery:
  - failed node can be retried
  - or manually resolved with user-provided JSON output

## Tech Stack

- Backend: TypeScript, Node.js, Hono
- Frontend: React 19, Vite, Tailwind CSS, React Query, React Flow (`@xyflow/react`)
- Persistence: Firestore (`workflows`, `nodes`, `executions`, `user_actions`)
- Runtime coordination (ephemeral): in-memory async queues for SSE fanout, step controls, and pending user-action resolvers

## Local Setup

## Firebase Env Vars (Required for Backend)

Preferred: create `backend/.env` (already supported by the backend at startup):

```env
FIREBASE_API_KEY="<your_web_api_key>"
FIREBASE_AUTH_DOMAIN="<your_project>.firebaseapp.com"
FIREBASE_PROJECT_ID="<your_project_id>"
FIREBASE_STORAGE_BUCKET="<your_project>.firebasestorage.app"
FIREBASE_MESSAGING_SENDER_ID="<your_sender_id>"
FIREBASE_APP_ID="<your_app_id>"
# optional:
FIREBASE_MEASUREMENT_ID="<your_measurement_id>"
```

Alternative: export env vars manually before starting backend:

```bash
export FIREBASE_API_KEY=\"<your_web_api_key>\"
export FIREBASE_AUTH_DOMAIN=\"<your_project>.firebaseapp.com\"
export FIREBASE_PROJECT_ID=\"<your_project_id>\"
export FIREBASE_STORAGE_BUCKET=\"<your_project>.firebasestorage.app\"
export FIREBASE_MESSAGING_SENDER_ID=\"<your_sender_id>\"
export FIREBASE_APP_ID=\"<your_app_id>\"
# optional:
export FIREBASE_MEASUREMENT_ID=\"<your_measurement_id>\"
```

Then run backend in the same terminal session.

## 1) Backend API (port `8000`)

```bash
cd backend
npm install
npm run dev
```

Runs: `http://localhost:8000`

## 2) Sandbox Test API (port `8001`)

In a second terminal:

```bash
cd backend
npm run sandbox
```

Runs: `http://localhost:8001`

Used by the UI to simulate third-party behavior modes (`normal`, `delayed`, `random_fail`, `fail`).

## 3) Frontend (port `5173`)

In a third terminal:

```bash
cd frontend
npm install
npm run dev
```

Runs: `http://localhost:5173`

Vite proxies `/api/*` to backend at `http://localhost:8000`.

## API Overview

## Workflows

- `POST /api/workflows`
- `GET /api/workflows`
- `GET /api/workflows/:id`
- `PUT /api/workflows/:id`
- `DELETE /api/workflows/:id`
- `POST /api/workflows/:id/validate`
- `POST /api/workflows/:id/execute` with optional body `{ "step_through": true }`

## Executions

- `GET /api/executions?workflow_id=:id`
- `GET /api/executions/:id`
- `GET /api/executions/:id/stream` (SSE)
- `POST /api/executions/:id/step`
- `GET /api/executions/:id/user-action`
- `POST /api/executions/:id/retry` body `{ "node_id": "..." }`
- `POST /api/executions/:id/user-input` body `{ "node_id": "...", "data": { ... } }`

## Nodes

- `POST /api/nodes`
- `GET /api/nodes`
- `GET /api/nodes/:id`
- `PUT /api/nodes/:id`
- `DELETE /api/nodes/:id`

## Config / Health

- `GET /health`
- `GET /api/config`
- `POST /api/config/sandbox/toggle`

## SSE Events

`/api/executions/:id/stream` emits:

- `node_update`
- `user_action_required`
- `execution_complete`

Example:

```text
event: node_update
data: {"node_id":"fetch_credit_score","status":"running"}

event: user_action_required
data: {"user_action_id":"...","node_id":"fetch_credit_score","error":"HTTP 503"}

event: execution_complete
data: {"status":"success"}
```

## Execution Model

- Engine traverses the workflow as a DAG, batches ready nodes, and runs independent ready nodes concurrently.
- `third_party` nodes call configured HTTP endpoints and retry using exponential backoff.
- `branch` nodes evaluate conditions (`equals`, `contains`, `gt`, `lt`, `exists`) on context data and prune non-selected outgoing paths.
- Node outputs are written into execution context under both nested and flattened aliases:
  - `context.nodes.<nodeId>.response`
  - `context["nodes.<nodeId>.response"]`
  - `context["nodes.<nodeId>.response.<key>"]`

## Interview Requirement Coverage

- Core DAG engine: implemented
- Third-party node + branch node: implemented
- Interactive DAG visualization with runtime path/status: implemented
- Retry/backoff + timeout + clear error states: implemented
- Step-through mode: implemented
- Mock/sandbox testing mode: implemented (separate sandbox service)
- DAG validation: implemented (cycle + structural checks)
- Concurrent independent branches: implemented
- Human recovery path (retry/manual input): implemented
- Partial execution recovery after process restart: not fully implemented (ephemeral runtime queues)
- Workflow versioning/diffing: not implemented

## Repository Structure

```text
footprint_task/
├── backend/
│   ├── src/index.ts                  # API server
│   ├── src/sandbox.ts                # Sandbox third-party API simulator
│   ├── src/engine/
│   │   ├── dag.ts                    # DAG validation + topological sort
│   │   ├── executor.ts               # Execution orchestrator
│   │   └── nodes/
│   │       ├── thirdParty.ts         # HTTP execution + retry/timeout
│   │       └── branch.ts             # Condition evaluation
│   ├── src/routes/
│   │   ├── workflows.ts
│   │   ├── executions.ts
│   │   └── nodes.ts
│   ├── src/store/hybridStore.ts      # Firestore CRUD + in-memory runtime queues
│   └── src/types/
│       ├── workflow.ts
│       └── execution.ts
└── frontend/
    └── src/components/
        ├── WorkflowControlPanel.tsx  # Workflow + execution list + sandbox mode toggles
        ├── VisPanel.tsx              # DAG visualization + live execution statuses
        └── UserActionPanel.tsx       # Human-in-the-loop retry/input panel
```

## Backend Component Architecture

- `API Layer` (`backend/src/index.ts`, `backend/src/routes/*`)
  - Exposes REST endpoints for workflows, nodes, executions, and control actions.
  - Exposes SSE stream endpoint for live execution updates.
- `Execution Engine` (`backend/src/engine/executor.ts`)
  - Orchestrates DAG execution lifecycle.
  - Schedules ready nodes, supports concurrent independent branches, and persists state transitions.
  - Emits runtime events (`node_update`, `user_action_required`, `execution_complete`).
- `DAG Validation + Ordering` (`backend/src/engine/dag.ts`)
  - Validates structural correctness (start/end rules, reference integrity, cycle detection).
  - Provides topological ordering utilities used by execution flow logic.
- `Node Runners` (`backend/src/engine/nodes/*`)
  - `thirdParty.ts`: executes HTTP calls with timeout + retry/backoff policy.
  - `branch.ts`: evaluates condition expressions and resolves next execution path.
- `Persistence + Runtime Coordination` (`backend/src/store/hybridStore.ts`)
  - Persists workflows, nodes, executions, and user actions in Firestore.
  - Manages in-memory async queues for SSE fanout, step-through signals, and user-action wait/resume.
- `Sandbox Service` (`backend/src/sandbox.ts`)
  - Independent mock API used to simulate third-party integration behavior and failure modes.

Request / execution flow:

1. Client triggers `/api/workflows/:id/execute`.
2. API validates workflow DAG and creates an execution record.
3. Engine runs nodes, updates persisted node state, and emits SSE events.
4. On failure, engine transitions to `pending_user_input` and waits for `/retry` or `/user-input`.
5. Engine resumes, completes execution, and emits `execution_complete`.

## Notes / Tradeoffs

- Firestore persists workflows, nodes, executions, and user actions.
- SSE subscriptions, step controls, and pending user-action waiters are in-memory, so in-flight control state is not durable across backend restarts.
- No auth is implemented for this interview build.
- Test coverage is limited in current state.
