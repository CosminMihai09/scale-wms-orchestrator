# Scale WMS – Microservices Orchestrator (POC)

Orchestrator API that receives requests from the warehouse management system (Scale) and routes them to microservices via **RabbitMQ**. Routing is driven by **HTTP headers** so the WMS only needs to call one endpoint and set the right header.

## Architecture

```
  [Scale WMS]  -->  [Orchestrator API]  -->  [RabbitMQ]
                            |                      |
                            v                      v
                    X-Routing-Key header    Topic exchange "scale.topic"
                                                    |
                    +----------------+---------------+----------------+
                    |                |               |                |
                    v                v               v                v
            [Logging]        [Reporting]      [Mock Worker]    (future services)
```

- **Orchestrator**: Single Express API; accepts any path/method, reads routing key from header, publishes to RabbitMQ, **waits for a reply** from the microservice, then returns that reply to the WMS (request–reply). If no reply within the timeout, returns `504 Gateway Timeout`.
- **RabbitMQ**: Topic exchange `scale.topic`; routing keys: `logging`, `reporting`, `worker`. A dedicated reply queue `orchestrator.replies` is used for microservice responses.
- **Microservices**: Each consumes its own queue, processes the message, **sends a reply** (status + body) back to the orchestrator’s reply queue, then acks. Restart automatically in Docker.

## Routing (headers)

The WMS must send the routing key in an HTTP header. The orchestrator checks (in order):

| Header            | Example value   |
|-------------------|-----------------|
| `x-routing-key`   | `logging`       |
| `X-Routing-Key`   | `reporting`     |
| `x-scale-routing-key` | `worker`   |

**POC routing keys:**

| Routing key  | Microservice      | Purpose        |
|--------------|-------------------|----------------|
| `logging`    | Logging service   | Log events     |
| `reporting`  | Reporting service | Report events  |
| `worker`     | Mock worker       | Generic jobs   |

If the header is missing, the orchestrator returns `400` with a hint.

## Request–reply (returning data to the WMS)

The orchestrator **waits for a response** from the microservice and returns it to the WMS:

1. WMS sends request to orchestrator with `X-Routing-Key`.
2. Orchestrator publishes to RabbitMQ with a **correlation ID** and **reply queue** name.
3. The target microservice processes the message and **publishes a reply** to the reply queue with the same correlation ID.
4. Orchestrator receives the reply and **responds to the WMS** with that reply (HTTP status and body).

**Reply format** (microservice → orchestrator): JSON with optional `statusCode` (default `200`) and `body`. The orchestrator forwards `statusCode` as the HTTP status and `body` as the response body. Example from a microservice:

```json
{ "statusCode": 200, "body": { "ok": true, "items": [] } }
```

**Timeout**: If the microservice doesn’t reply within **30 seconds** (configurable via `REPLY_TIMEOUT_MS`), the orchestrator returns **504 Gateway Timeout** to the WMS.

## Performance considerations

When the WMS sends many requests at once (e.g. 100 concurrent requests), here’s how the system behaves:

- **Orchestrator (Express)**  
  Node is single-threaded but non-blocking. All requests are accepted and handled concurrently. Each request gets its own correlation ID, publishes to RabbitMQ, and awaits its reply (a Promise). That doesn’t block other requests. So many in-flight requests (e.g. 100) are fine: many pending promises and many HTTP connections waiting. No change is required for concurrency at the orchestrator.

- **RabbitMQ**  
  All messages are published to the exchange and routed to the right queues. RabbitMQ handles high message volume; this is not a bottleneck.

- **Microservices (one instance each)**  
  Each service has one consumer per instance and processes one message at a time from its queue. If many requests go to the **same** routing key (e.g. all to `logging`), they queue up and that single instance processes them one after another. The first request gets a quick reply; later ones may wait (e.g. the 100th waits for 99 others). If traffic is **spread** across logging, reporting, and worker, each service gets a share and they run in parallel, but within each service processing is still one-by-one.

- **Replies**  
  Replies can arrive in any order. The orchestrator matches each reply to the right HTTP request by correlation ID and sends that response to the WMS. No mix-up.

- **Scaling**  
  To handle high load on a given routing key, run **multiple instances** of that microservice (e.g. `docker compose up -d --scale logging-service=3`). All instances consume from the same queue; RabbitMQ distributes messages across them. Throughput and latency improve without code changes.

## Run everything (Docker)

```bash
docker compose up -d
```

- **Orchestrator**: http://localhost:3000  
- **RabbitMQ Management**: http://localhost:15672 (user: `scale`, pass: `scale_secret`)

Containers use `restart: unless-stopped` so they come back after crashes or host restarts.

## Quick test (from host)

```bash
# Health
curl http://localhost:3000/health

# Route to logging
curl -X POST http://localhost:3000/any/path \
  -H "X-Routing-Key: logging" \
  -H "Content-Type: application/json" \
  -d '{"event":"test","level":"info"}'

# Route to reporting
curl -X POST http://localhost:3000/reports/daily \
  -H "X-Routing-Key: reporting" \
  -H "Content-Type: application/json" \
  -d '{"report":"inventory"}'

# Route to mock worker
curl -X POST http://localhost:3000/jobs/process \
  -H "X-Routing-Key: worker" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"123"}'
```

Each request returns the **microservice reply** (e.g. `200` with JSON body). Check orchestrator response and each service’s logs:

```bash
docker compose logs -f logging-service
docker compose logs -f reporting-service
docker compose logs -f mock-worker-service
```

## WMS integration

Point Scale to the orchestrator base URL (e.g. `http://orchestrator-host:3000`). For each integration type:

1. **URL**: Same base URL; path can be anything (e.g. `/scale/logging`, `/scale/reporting`, `/scale/worker`).
2. **Headers**: Set `X-Routing-Key` (or `x-routing-key`) to one of: `logging`, `reporting`, `worker`.
3. **Body**: Your existing JSON/payload; it is forwarded in the message body to the right microservice.

The orchestrator forwards method, path, query, headers, and body in the RabbitMQ message so services have full context. The WMS receives the microservice’s reply (status and body) as the HTTP response.

## Documentation

- **docs/ARCHITECTURE.md** – Architecture design document (components, data flow, messaging topology, deployment, design decisions).
- **docs/flow-diagram.md** – Flow diagrams in Mermaid (architecture, request–reply sequence, RabbitMQ topology, concurrent requests). Renders in GitHub, GitLab, VS Code (Mermaid extension), or [mermaid.live](https://mermaid.live) for export to PNG/SVG.

## Project layout

```
.
├── docker-compose.yml      # RabbitMQ + orchestrator + 3 POC services
├── docs/
│   ├── ARCHITECTURE.md     # Architecture design document
│   └── flow-diagram.md    # Mermaid flow diagrams
├── orchestrator/           # Express API, publishes to RabbitMQ
├── logging-service/        # Consumes "logging"
├── reporting-service/      # Consumes "reporting"
├── mock-worker-service/   # Consumes "worker"
└── README.md
```

## Adding new microservices

1. Add a new service folder (e.g. `inventory-service/`) with its own `Dockerfile` and consumer that binds a queue to `scale.topic` with a new routing key (e.g. `inventory`).
2. Add the service and its `RABBITMQ_URL` to `docker-compose.yml` with `restart: unless-stopped`.
3. In the consumer: when processing a message, if `msg.properties.replyTo` and `msg.properties.correlationId` are set, send a reply with `channel.sendToQueue(replyTo, content, { correlationId })`. Reply body should be JSON: `{ statusCode?: number, body?: any }`.
4. In the WMS, use the same orchestrator URL and set `X-Routing-Key: inventory` (or your key). No change to the orchestrator is required.
