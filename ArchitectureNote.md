# Architecture Diagrams

## 1) System Context

```mermaid
flowchart LR
    U[User]
    FE[Frontend UI\nReact + Vite + React Flow]
    BE[Backend API\nHono on :8000]
    SB[Sandbox API\nHono on :8001]
    FS[(Firestore)]

    U --> FE
    FE -->|REST + SSE| BE
    FE -->|Set mode + test behavior| SB
    BE -->|Read/Write| FS
    BE -->|HTTP calls from third_party nodes| SB
```

## 2) Backend Component Architecture

```mermaid
flowchart TB
    IDX[index.ts\nRoute registration + CORS + config]

    subgraph Routes
      WF[workflows.ts\nCRUD + validate + execute]
      EX[executions.ts\nstatus + stream + step + retry/input]
      ND[nodes.ts\nNode CRUD]
    end

    subgraph Engine
      DAG[dag.ts\nValidation + cycle detection + topo sort]
      EXEC[executor.ts\nScheduling + state transitions + SSE emits]
      TP[thirdParty.ts\nHTTP + timeout + retry/backoff]
      BR[branch.ts\nCondition evaluation + route selection]
    end

    subgraph Store
      HS[hybridStore.ts\nFirestore CRUD + in-memory runtime queues]
    end

    FB[firebase.ts\nInit Firebase app from env]

    IDX --> WF
    IDX --> EX
    IDX --> ND

    WF --> DAG
    WF --> EXEC

    EXEC --> TP
    EXEC --> BR
    EXEC --> HS

    WF --> HS
    EX --> HS
    ND --> HS

    HS --> FB
```

## 3) Execution Sequence (Run + Failure Recovery)

```mermaid
sequenceDiagram
    participant UI as Frontend UI
    participant API as Backend API
    participant ENG as Executor
    participant ST as HybridStore
    participant TP as thirdParty Node
    participant FS as Firestore

    UI->>API: POST /api/workflows/:id/execute
    API->>ST: create execution record (running)
    ST->>FS: persist execution
    API-->>UI: 202 { execution_id }

    UI->>API: GET /api/executions/:id/stream (SSE)

    API->>ENG: start background execution
    ENG->>ST: node running/success updates
    ST->>FS: persist node_states
    ST-->>UI: SSE node_update

    ENG->>TP: run third_party node
    TP-->>ENG: success OR error

    alt success
      ENG->>ST: mark success + append path
      ST-->>UI: SSE node_update
      ENG->>ST: finalize success
      ST-->>UI: SSE execution_complete
    else failure
      ENG->>ST: mark failed
      ST-->>UI: SSE node_update(failed)
      ENG->>ST: create pending user action
      ST-->>UI: SSE user_action_required

      alt user clicks Retry
        UI->>API: POST /api/executions/:id/retry
      else user submits JSON
        UI->>API: POST /api/executions/:id/user-input
      end

      API->>ST: signal user action resolver
      ST-->>ENG: resume node
      ENG->>ST: continue execution
      ST-->>UI: SSE node_update / execution_complete
    end
```

## Notes
- These diagrams match current code organization (`hybridStore.ts`, Hono routes, SSE-driven updates).
- You can paste this file directly into GitHub/Notion that supports Mermaid rendering.
