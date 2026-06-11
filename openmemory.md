# OpenMemory Guide – scale-wms-orchestrator

## Overview

Scale WMS microservices orchestrator: Express API routes HTTP requests via RabbitMQ to logging and SQL worker services. Request-reply pattern with correlation IDs.

## Architecture

- **orchestrator/** – HTTP entry point, publishes to `scale.topic`, consumes `orchestrator.replies`
- **logging-service/** – Logs requests (routing key `logging`)
- **worker-service/** – Named SQL queries against SQL Server `ils` DB (routing key `worker`)
- **RabbitMQ** – Topic exchange `scale.topic`

## User Defined Namespaces

- (none defined)

## Components

| Component | Path | Purpose |
|-----------|------|---------|
| Orchestrator | `orchestrator/` | HTTP → RabbitMQ → HTTP reply |
| Logging | `logging-service/` | Request logging |
| Worker | `worker-service/` | SQL named queries via `mssql` pool |
| Scripts | `scripts/` | `test-db-connection.js`, `capacity-test.js` |

## Patterns

- Routing via `X-Routing-Key` header
- Worker body: `{ "query": "<name>", "params": {} }` — queries in `worker-service/src/queries.js`
- Throughput: worker prefetch 20, orchestrator reply prefetch 50, DB pool max 20
- SQL config: `.env` + `config/database.js` (DB_SERVER, DB_PORT, DB_NAME, credentials)
