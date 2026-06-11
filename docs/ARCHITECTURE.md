# Scale WMS – Architecture Design Document

**Version:** 1.1  
**Status:** POC  
**Last updated:** 2026

---

## 1. Purpose and scope

This document describes the architecture of the **Scale WMS Microservices Orchestrator**: a system that receives HTTP requests from the warehouse management system (Scale) and routes them to decoupled microservices via **RabbitMQ**. The WMS integrates through a single API (the orchestrator) and uses **HTTP headers** for routing, so no changes are required in Scale's integration layer beyond setting the appropriate header.

**Scope:**

- Orchestrator API (single entry point)
- RabbitMQ as message broker
- Microservices: logging, SQL worker
- Request–reply pattern so the WMS receives data back from microservices
- Deployment via Docker with restart policies

**Out of scope for this document:** Security (authn/authz), monitoring/observability, persistence inside microservices.

---

## 2. System context

| Actor / system      | Role |
|---------------------|------|
| **Scale WMS**       | External system; sends HTTP requests to the orchestrator with a routing key in headers and optional JSON body. Expects HTTP response (status + body) from the target microservice. |
| **Orchestrator API**| Single entry point; accepts requests, publishes to RabbitMQ, waits for reply, returns reply to WMS. |
| **RabbitMQ**        | Message broker; topic exchange for routing; dedicated reply queue for microservice responses. |
| **Microservices**   | Consumers of queues; process messages and send replies back to the orchestrator. |
| **SQL Server**      | External database (`ils` on `APTUSVALENTIN\SQL2022DEV`); queried by the worker service via named, parameterized queries. |

---

## 3. Component overview

### 3.1 High-level architecture

```mermaid
flowchart LR
    subgraph External
        WMS[Scale WMS]
        SQL[("SQL Server ils")]
    end

    subgraph "Orchestrator"
        API[Orchestrator API<br/>Express]
    end

    subgraph "Message broker"
        RMQ[RabbitMQ<br/>scale.topic]
        RQ[Reply queue<br/>orchestrator.replies]
    end

    subgraph "Microservices"
        LOG[Logging service]
        WRK[Worker service]
    end

    WMS -->|"HTTP + X-Routing-Key"| API
    API -->|"Publish (routing key)"| RMQ
    RMQ --> LOG
    RMQ --> WRK
    WRK -->|"Named queries"| SQL
    LOG -->|"Reply"| RQ
    WRK -->|"Reply"| RQ
    RQ -->|"Consume reply"| API
    API -->|"HTTP response"| WMS
```

### 3.2 Components

| Component           | Technology   | Responsibility |
|--------------------|-------------|----------------|
| **Orchestrator API** | Node.js, Express | Accept any HTTP method/path; read `X-Routing-Key` from headers; publish request payload to RabbitMQ topic exchange with correlation ID and reply queue; consume from reply queue; match reply by correlation ID; return HTTP response to WMS. Timeout (default 30s) → 504. Prefetch 50 on reply queue. |
| **RabbitMQ**       | RabbitMQ 3.x | Topic exchange `scale.topic`; routing keys: `logging`, `worker`. Queue `orchestrator.replies` for microservice replies. Durable queues and exchange. |
| **Logging service** | Node.js, amqplib | Consume from queue bound to `logging`; process message; send reply `{ statusCode, body }` to `orchestrator.replies` with same correlation ID; ack. |
| **Worker service**  | Node.js, amqplib, mssql | Consume from queue bound to `worker`; execute named SQL query from request body against `ils` DB; send reply with rows or error; ack. Connection pool (max 20), prefetch 20. |

---

## 4. Data flow and request–reply

### 4.1 Request–reply sequence

```mermaid
sequenceDiagram
    participant WMS as Scale WMS
    participant Orch as Orchestrator API
    participant RMQ as RabbitMQ
    participant Svc as Microservice

    WMS->>Orch: HTTP request (X-Routing-Key, body)
    Orch->>Orch: Generate correlationId, store pending reply
    Orch->>RMQ: Publish to scale.topic (routingKey, replyTo, correlationId)
    Orch-->>WMS: (waiting)

    RMQ->>Svc: Deliver message to queue
    Svc->>Svc: Process message
    Svc->>RMQ: Send reply to orchestrator.replies (correlationId)
    RMQ->>Orch: Deliver reply
    Orch->>Orch: Match correlationId, resolve pending reply
    Orch->>WMS: HTTP response (status + body)
```

### 4.2 Message payload (Orchestrator → Microservice)

The orchestrator publishes a JSON payload containing:

- `method` – HTTP method
- `path` – request path
- `query` – query string object
- `headers` – request headers
- `body` – request body (parsed or raw)
- `timestamp` – ISO timestamp

Message properties:

- `replyTo`: `orchestrator.replies`
- `correlationId`: UUID
- `contentType`: `application/json`

### 4.3 Worker request body

For `X-Routing-Key: worker`, the HTTP body must be:

```json
{ "query": "<name>", "params": { } }
```

Named queries are defined in `worker-service/src/queries.js`. Unknown query → 400. SQL error → 500.

### 4.4 Reply payload (Microservice → Orchestrator)

JSON:

- `statusCode` (optional, default 200) – HTTP status to return to WMS
- `body` (optional) – response body (object or primitive)

Worker success body: `{ ok, query, rowCount, rows }`.

The orchestrator returns this as the HTTP response to the WMS.

---

## 5. Messaging topology (RabbitMQ)

### 5.1 Topology diagram

```mermaid
flowchart TB
    subgraph Exchange
        EX[scale.topic<br/>topic exchange]
    end

    subgraph "Request queues"
        QL[scale.logging]
        QW[scale.worker]
    end

    subgraph "Reply"
        RQ[orchestrator.replies]
    end

    EX -->|"routing key: logging"| QL
    EX -->|"routing key: worker"| QW

    LOG[Logging service] -.->|consume| QL
    WRK[Worker service] -.->|consume| QW

    LOG -->|sendToQueue| RQ
    WRK -->|sendToQueue| RQ
    Orch[Orchestrator] -.->|consume| RQ
```

### 5.2 Routing keys

| Routing key | Queue          | Consumer           |
|------------|----------------|--------------------|
| `logging`  | scale.logging  | Logging service    |
| `worker`   | scale.worker   | Worker service     |

The WMS sets the desired routing key in the HTTP header `X-Routing-Key` (or `x-routing-key`, `x-scale-routing-key`).

---

## 6. Deployment

### 6.1 Docker topology

All components run as separate Docker containers:

- **rabbitmq** – single node; ports 5672 (AMQP), 15672 (Management UI); health check; `restart: unless-stopped`
- **orchestrator** – single instance; port 3000; depends on RabbitMQ healthy; `restart: unless-stopped`
- **logging-service**, **worker-service** – one instance each by default; depend on RabbitMQ healthy; `restart: unless-stopped`

Scaling: multiple instances of a microservice can be run (e.g. `docker compose up -d --scale worker-service=2`). All instances consume from the same queue; RabbitMQ distributes messages (competing consumers).

### 6.2 Configuration

| Component     | Key env vars        |
|---------------|---------------------|
| RabbitMQ      | `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS` |
| Orchestrator  | `RABBITMQ_URL`, `ORCHESTRATOR_PORT`, `REPLY_TIMEOUT_MS`, `ORCHESTRATOR_REPLY_PREFETCH` |
| Logging       | `RABBITMQ_URL`      |
| Worker        | `RABBITMQ_URL`, `DB_SERVER`, `DB_PORT`, `DB_INSTANCE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `WORKER_PREFETCH`, `DB_POOL_MAX` |

### 6.3 SQL Server connectivity

The worker container uses `DB_SERVER=192.168.123.242` (LAN IP) because mDNS hostnames may not resolve inside Docker. Prefer a static `DB_PORT` over instance-name discovery (SQL Browser UDP 1434).

---

## 7. Key design decisions

| Decision | Rationale |
|----------|------------|
| **Single orchestrator API** | WMS can call one base URL; routing is header-based so Scale only needs to set the right header. |
| **Routing key in HTTP header** | Headers are the only place easily configurable from the WMS for routing. |
| **Request–reply over RabbitMQ** | WMS needs synchronous responses; correlation ID + reply queue provides this without coupling WMS to individual service URLs. |
| **Named queries (not raw SQL)** | Safer; queries are reviewed and registered in code before deployment. |
| **Connection pool + prefetch** | Sustains ≥10 API calls/sec with concurrent message processing. |
| **Topic exchange** | Allows multiple routing keys and future pattern-based bindings if needed. |
| **Durable queues and exchange** | Messages survive broker restart. |
| **Docker restart: unless-stopped** | Services recover automatically after crashes or host restart. |

---

## 8. References

- **README.md** – Setup, routing keys, quick test, WMS integration, SQL Server prerequisites.
- **docker-compose.yml** – Service definitions and environment.
- **worker-service/src/queries.js** – Named query registry.
