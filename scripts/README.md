# Scripts

## Capacity test

Sends 1000 requests to **each** microservice (logging, reporting, worker) via the orchestrator and logs timing and completion.

**Prerequisites:** Orchestrator and all services running (e.g. `docker compose up -d`).

**Run (default: 1000 requests per service, concurrency 50):**

```bash
node scripts/capacity-test.js
```

**Options:**

```bash
node scripts/capacity-test.js [baseUrl] [concurrency] [requestsPerService]
```

| Argument              | Default              | Description                          |
|-----------------------|---------------------|--------------------------------------|
| baseUrl               | http://localhost:3000 | Orchestrator base URL                |
| concurrency           | 50                  | Requests in flight per service       |
| requestsPerService    | 1000                | Number of requests per routing key   |

**Examples:**

```bash
# Default (1000 per service, concurrency 50)
node scripts/capacity-test.js

# Higher concurrency, 500 requests per service
node scripts/capacity-test.js http://localhost:3000 100 500

# Custom orchestrator URL
node scripts/capacity-test.js http://my-host:3000
```

**Output:** Start/end timestamps per service, duration, success/error counts, requests per second, and a summary table.
