#!/usr/bin/env node
/**
 * Capacity test: sends requests to logging and worker services via the orchestrator.
 *
 * Usage: node scripts/capacity-test.js [baseUrl] [concurrency] [requestsPerService]
 *   baseUrl            default http://localhost:3000
 *   concurrency        default 100 (requests in flight per service)
 *   requestsPerService default 1000
 *
 * Example: node scripts/capacity-test.js
 *          node scripts/capacity-test.js http://localhost:3000 20 300
 */

const BASE_URL = process.argv[2] || "http://localhost:3000";
const CONCURRENCY = Math.max(1, parseInt(process.argv[3], 10) || 100);
const REQUESTS_PER_SERVICE = Math.max(1, parseInt(process.argv[4], 10) || 1000);

const ROUTING_KEYS = ["logging", "worker"];

const REQUEST_BODIES = {
  logging: (index) => ({ requestIndex: index, ts: Date.now() }),
  worker: () => ({ query: "ping" }),
};

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function sendOne(url, routingKey, index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  const bodyFactory = REQUEST_BODIES[routingKey] || (() => ({}));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Routing-Key": routingKey,
      },
      body: JSON.stringify(bodyFactory(index)),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const ok = res.ok;
    const body = await res.text();
    return { ok, status: res.status, body };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 0, error: err.message };
  }
}

async function runBatch(url, routingKey, startIndex, count) {
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(sendOne(url, routingKey, startIndex + i));
  }
  return Promise.all(promises);
}

async function runService(baseUrl, routingKey, totalRequests) {
  const start = Date.now();
  let completed = 0;
  let success = 0;
  let errors = 0;

  log(`${routingKey}: starting ${totalRequests} requests (concurrency ${CONCURRENCY})`);

  while (completed < totalRequests) {
    const batchSize = Math.min(CONCURRENCY, totalRequests - completed);
    const results = await runBatch(baseUrl, routingKey, completed, batchSize);
    completed += results.length;
    for (const r of results) {
      if (r.ok) success++;
      else errors++;
    }
  }

  const elapsed = Date.now() - start;
  const rps = (totalRequests / (elapsed / 1000)).toFixed(2);
  log(`${routingKey}: completed in ${(elapsed / 1000).toFixed(2)}s | ${success} ok, ${errors} errors | ${rps} req/s`);

  return {
    routingKey,
    totalRequests,
    success,
    errors,
    elapsedMs: elapsed,
    rps: totalRequests / (elapsed / 1000),
  };
}

async function main() {
  const url = BASE_URL.replace(/\/$/, "");
  const wallStart = Date.now();
  log(`Capacity test: ${REQUESTS_PER_SERVICE} requests per service, concurrency ${CONCURRENCY} (parallel)`);
  log(`Orchestrator: ${url}`);
  log("---");

  const results = await Promise.all(
    ROUTING_KEYS.map((key) => runService(url, key, REQUESTS_PER_SERVICE))
  );

  const wallElapsed = Date.now() - wallStart;
  const totalRequests = results.length * REQUESTS_PER_SERVICE;

  log("---");
  log("Summary:");
  log(`  Total requests: ${totalRequests} (${REQUESTS_PER_SERVICE} × ${ROUTING_KEYS.length} services)`);
  log(`  Wall-clock time: ${(wallElapsed / 1000).toFixed(2)}s`);
  log(`  Overall:        ${(totalRequests / (wallElapsed / 1000)).toFixed(2)} req/s`);
  log("");
  log("Per service:");
  for (const r of results) {
    log(`  ${r.routingKey.padEnd(10)} ${(r.elapsedMs / 1000).toFixed(2)}s  ${r.success} ok  ${r.errors} err  ${r.rps.toFixed(2)} req/s`);
  }

  const worker = results.find((r) => r.routingKey === "worker");
  if (worker && worker.rps < 10) {
    log("");
    log("WARNING: worker throughput is below 10 req/s target.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
