# Scale WMS – Microservices Orchestrator

Orchestrator API that receives requests from the warehouse management system (Scale) and routes them to microservices via **RabbitMQ**. Routing is driven by **HTTP headers** (`X-Routing-Key`). Request–reply is supported so the WMS gets responses back from microservices.

## Services

| Service | Routing key | Purpose |
|---------|-------------|---------|
| Logging | `logging` | Logs incoming requests |
| Worker | `worker` | Executes named SQL queries against SQL Server (`ils` DB) |

## Quick start (Docker)

```bash
docker compose up -d --build
```

- **Orchestrator:** http://localhost:3000  
- **RabbitMQ Management:** http://localhost:15672 (user: `scale`, pass: `scale_secret`)

See **docs/DOCKER-INSTALL.md** for installing Docker on macOS.

## SQL Server prerequisite

The worker connects to `APTUSVALENTIN\SQL2022DEV` (database `ils`). Before starting:

1. Enable **TCP/IP** for the `SQL2022DEV` instance (SQL Server Configuration Manager).
2. Set a **static TCP port** (recommended) or start **SQL Server Browser** (UDP 1434).
3. Allow the TCP port (and UDP 1434 if using Browser) through **Windows Firewall**.

Configure SQL Server connection (copy template and edit):

```bash
cp .env.example .env
```

Test connectivity from your Mac:

```bash
npm install
node scripts/test-db-connection.js
```

## Scale-compatible Shipment Headers API

Drop-in replacement for the Scale integration GET endpoint (no routing header required):

```bash
curl "http://localhost:3000/ilsintegrationservices/scaleapi/ShipmentHeadersApi/Get?shipmentId=DIRE1&warehouse=MN"
```

Returns a JSON **array** of shipment objects with **PascalCase** property names, matching the real Scale API response shape.

## Worker API contract (internal / load tests)

Send requests to the orchestrator with `X-Routing-Key: worker` and a JSON body:

```json
{ "query": "ping", "params": {} }
```

Built-in queries: `ping`, `db-info`, `list-tables`, `ShipmentHeader.by.ShipmentId.and.Warehouse`. Add more in `worker-service/src/queries.js`.

**Example:**

```bash
curl -X POST http://localhost:3000/query \
  -H "X-Routing-Key: worker" \
  -H "Content-Type: application/json" \
  -d '{"query":"ping"}'
```

## Scaling: multiple instances

To handle higher load, run **multiple instances** of a microservice. Each instance consumes from the same queue; RabbitMQ distributes messages across them.

```bash
# Scale logging to 3 instances, worker to 2
docker compose up -d --scale logging-service=3 --scale worker-service=2

# Reset to one instance per service
docker compose up -d --scale logging-service=1 --scale worker-service=1
```

**Note:** Do not scale `rabbitmq` or `orchestrator` unless you have a specific multi-instance setup. Scaling is for logging and worker services.

The worker is tuned for **≥10 req/s** (prefetch 20, connection pool 20). Use `--scale worker-service=N` for more headroom.

## Capacity test script

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
node scripts/capacity-test.js
node scripts/capacity-test.js http://localhost:3000 20 300
node scripts/capacity-test.js http://localhost:3000 10 10
```

## Routing (headers)

Set the routing key in an HTTP header. The orchestrator checks (in order): `x-routing-key`, `X-Routing-Key`, `x-scale-routing-key`.

| Routing key  | Microservice      |
|--------------|-------------------|
| `logging`    | Logging service   |
| `worker`     | SQL worker        |

**Quick test:**

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/any/path \
  -H "X-Routing-Key: logging" \
  -H "Content-Type: application/json" \
  -d '{"event":"test"}'
```

## Configuration

**SQL Server** — single source of truth in [`.env`](.env) (copy from [`.env.example`](.env.example)), loaded by [config/database.js](config/database.js):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_SERVER` | `192.168.123.242` | SQL Server host (use LAN IP for Docker) |
| `DB_PORT` | `1433` | TCP port (preferred over instance name) |
| `DB_INSTANCE` | — | Named instance if not using `DB_PORT` |
| `DB_NAME` | `ils` | Database name |
| `DB_USER` / `DB_PASSWORD` | — | Login credentials |
| `DB_POOL_MAX` | `20` | Connection pool size per worker |
| `WORKER_PREFETCH` | `20` | RabbitMQ prefetch per worker |

Docker `worker-service` reads `.env` via `env_file`. Host scripts load the same file automatically.

| Component | Other env vars |
|-----------|----------------|
| Orchestrator | `RABBITMQ_URL`, `ORCHESTRATOR_PORT`, `ORCHESTRATOR_REPLY_PREFETCH` |

## Documentation

- **docs/ARCHITECTURE.md** – Architecture design document, data flow, messaging topology.
- **docs/flow-diagram.md** – Mermaid flow diagrams (architecture, request–reply, scaling).
- **docs/DOCKER-INSTALL.md** – Install Docker Desktop and run the project.
- **scripts/README.md** – Capacity test and DB connection test usage.

## Project layout

```
.
├── .env.example
├── config/
│   └── database.js
├── docker-compose.yml
├── docs/
├── orchestrator/
├── logging-service/
├── worker-service/
└── scripts/
    ├── capacity-test.js
    ├── test-db-connection.js
    └── README.md
```
