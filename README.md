# Scale WMS – Microservices Orchestrator (POC)

Orchestrator API that receives requests from the warehouse management system (Scale) and routes them to microservices via **RabbitMQ**. Routing is driven by **HTTP headers** (`X-Routing-Key`). Request–reply is supported so the WMS gets responses back from microservices.

## Quick start (Docker)

```bash
docker compose up -d --build
```

- **Orchestrator:** http://localhost:3000  
- **RabbitMQ Management:** http://localhost:15672 (user: `scale`, pass: `scale_secret`)

See **docs/DOCKER-INSTALL.md** for installing Docker on macOS.

## Scaling: multiple instances

To handle higher load, run **multiple instances** of a microservice. Each instance consumes from the same queue; RabbitMQ distributes messages across them.

**Examples:**

```bash
# Scale logging to 3 instances, reporting to 2, worker to 2
docker compose up -d --scale logging-service=3 --scale reporting-service=2 --scale mock-worker-service=2

# Scale only logging (e.g. 5 instances)
docker compose up -d --scale logging-service=5

# Reset to one instance per service
docker compose up -d --scale logging-service=1 --scale reporting-service=1 --scale mock-worker-service=1
```

**Note:** Do not scale `rabbitmq` or `orchestrator` unless you have a specific multi-instance setup (e.g. load-balanced orchestrator). Scaling is for the three microservices (logging, reporting, mock-worker).

After changing scale, run `docker compose up -d` again with the desired `--scale` options.

## Capacity test script

A script sends requests to each microservice via the orchestrator and logs timing and completion.

**Prerequisites:** Orchestrator and services running (e.g. `docker compose up -d`).

**Run (default: 1000 requests per service, concurrency 100, all three services in parallel):**

```bash
node scripts/capacity-test.js
```

**Options:**

```bash
node scripts/capacity-test.js [baseUrl] [concurrency] [requestsPerService]
```

| Argument             | Default                | Description                    |
|----------------------|------------------------|--------------------------------|
| baseUrl              | http://localhost:3000  | Orchestrator base URL          |
| concurrency          | 100                    | Requests in flight per service |
| requestsPerService   | 1000                   | Requests per routing key       |

**Examples:**

```bash
# Default
node scripts/capacity-test.js

# Higher concurrency, 500 requests per service
node scripts/capacity-test.js http://localhost:3000 200 500

# Quick smoke test (10 per service)
node scripts/capacity-test.js http://localhost:3000 10 10
```

Output includes per-service duration, success/error counts, req/s, and a summary. See **scripts/README.md** for more detail.

## Routing (headers)

Set the routing key in an HTTP header. The orchestrator checks (in order): `x-routing-key`, `X-Routing-Key`, `x-scale-routing-key`.

| Routing key  | Microservice      |
|--------------|-------------------|
| `logging`    | Logging service   |
| `reporting`  | Reporting service |
| `worker`     | Mock worker       |

**Quick test:**

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/any/path \
  -H "X-Routing-Key: logging" \
  -H "Content-Type: application/json" \
  -d '{"event":"test"}'
```

## Documentation

- **docs/ARCHITECTURE.md** – Architecture design document, data flow, messaging topology.
- **docs/flow-diagram.md** – Mermaid flow diagrams (architecture, request–reply, scaling).
- **docs/DOCKER-INSTALL.md** – Install Docker Desktop and run the project.
- **scripts/README.md** – Capacity test script usage.

## Project layout

```
.
├── docker-compose.yml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DOCKER-INSTALL.md
│   └── flow-diagram.md
├── orchestrator/
├── logging-service/
├── reporting-service/
├── mock-worker-service/
└── scripts/
    ├── capacity-test.js
    └── README.md
```
