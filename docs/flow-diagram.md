# Scale WMS – Flow diagrams

This file contains Mermaid diagrams that render in GitHub, GitLab, VS Code (with Mermaid extension), and many other tools. You can also export them to PNG/SVG using [Mermaid Live Editor](https://mermaid.live) or CLI.

---

## 1. Architecture (components and connections)

```mermaid
flowchart LR
    subgraph External
        WMS[Scale WMS]
        SQL[("SQL Server ils")]
    end

    subgraph "Orchestrator"
        API[Orchestrator API]
    end

    subgraph "RabbitMQ"
        EX[scale.topic]
        RQ[orchestrator.replies]
    end

    subgraph "Microservices"
        LOG[Logging]
        WRK[Worker]
    end

    WMS -->|HTTP + X-Routing-Key| API
    API -->|Publish| EX
    EX --> LOG
    EX --> WRK
    WRK -->|Named queries| SQL
    LOG -->|Reply| RQ
    WRK -->|Reply| RQ
    RQ -->|Consume| API
    API -->|HTTP response| WMS
```

---

## 2. Request–reply sequence (single request)

```mermaid
sequenceDiagram
    participant WMS as Scale WMS
    participant Orch as Orchestrator API
    participant RMQ as RabbitMQ
    participant Svc as Microservice

    WMS->>Orch: HTTP request (X-Routing-Key, body)
    Orch->>Orch: correlationId = UUID, store pending
    Orch->>RMQ: Publish (routingKey, replyTo, correlationId)
    Note over Orch,WMS: Orchestrator waits

    RMQ->>Svc: Message to service queue
    Svc->>Svc: Process
    Svc->>RMQ: Reply to orchestrator.replies (correlationId)
    RMQ->>Orch: Reply message
    Orch->>Orch: Match correlationId, resolve
    Orch->>WMS: HTTP response (status + body)
```

---

## 3. RabbitMQ topology (queues and bindings)

```mermaid
flowchart TB
    EX[scale.topic exchange]

    EX -->|logging| QL[scale.logging]
    EX -->|worker| QW[scale.worker]

    LOG[Logging service] --> QL
    WRK[Worker service] --> QW

    LOG --> RQ[orchestrator.replies]
    WRK --> RQ
    RQ --> Orch[Orchestrator]
```

---

## 4. Worker SQL query flow

```mermaid
sequenceDiagram
    participant WMS as Scale WMS
    participant Orch as Orchestrator
    participant WRK as Worker service
    participant SQL as SQL Server

    WMS->>Orch: POST body query ping
    Orch->>WRK: RabbitMQ message
    WRK->>WRK: Lookup named query in registry
    WRK->>SQL: Execute parameterized SQL
    SQL->>WRK: Result rows
    WRK->>Orch: Reply ok rowCount rows
    Orch->>WMS: HTTP 200 JSON response
```

---

## 5. Concurrent requests (multiple WMS requests)

```mermaid
sequenceDiagram
    participant W1 as WMS Request 1
    participant W2 as WMS Request 2
    participant Orch as Orchestrator
    participant RMQ as RabbitMQ
    participant S1 as Service instance 1
    participant S2 as Service instance 2

    W1->>Orch: Request (e.g. worker)
    W2->>Orch: Request (e.g. worker)
    Orch->>RMQ: Publish msg1 (corrId1)
    Orch->>RMQ: Publish msg2 (corrId2)
    Note over Orch: Both requests waiting

    RMQ->>S1: msg1
    RMQ->>S2: msg2
    S1->>RMQ: Reply corrId1
    S2->>RMQ: Reply corrId2
    RMQ->>Orch: Reply 1
    RMQ->>Orch: Reply 2
    Orch->>W1: Response 1
    Orch->>W2: Response 2
```

Replies can arrive in any order; the orchestrator matches each reply to the correct request via `correlationId`.
