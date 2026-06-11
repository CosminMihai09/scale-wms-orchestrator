#!/usr/bin/env node
/**
 * Fetches shipment IDs from ils DB and runs worker API calls with per-request timing.
 *
 * Usage: node scripts/shipment-query-test.js [baseUrl] [count] [concurrency]
 *   baseUrl      default http://localhost:3000
 *   count        default 100
 *   concurrency  default 10 (requests in flight)
 */

const sql = require("mssql");
const { buildMssqlConfig } = require("../config/database");

const BASE_URL = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const COUNT = Math.max(1, parseInt(process.argv[3], 10) || 100);
const CONCURRENCY = Math.max(1, parseInt(process.argv[4], 10) || 10);
const QUERY_NAME = "ShipmentHeader.by.ShipmentId.and.Warehouse";

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function fetchShipmentPool() {
  const pool = await sql.connect(buildMssqlConfig());
  const result = await pool.request().query(`
    SELECT sh.SHIPMENT_ID AS shipmentID, sh.warehouse AS warehouse
    FROM SHIPMENT_HEADER sh
    INNER JOIN WAREHOUSE w ON sh.warehouse = w.warehouse
    WHERE sh.SHIPMENT_ID IS NOT NULL AND sh.warehouse IS NOT NULL
    ORDER BY sh.DATE_TIME_STAMP DESC
  `);
  await pool.close();
  return result.recordset;
}

function buildShipmentList(pool, count) {
  if (pool.length === 0) return [];
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(pool[i % pool.length]);
  }
  return list;
}

async function callWorker(shipment) {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Routing-Key": "worker",
      },
      body: JSON.stringify({
        query: QUERY_NAME,
        params: {
          shipmentID: shipment.shipmentID,
          warehouse: shipment.warehouse,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const elapsedMs = performance.now() - start;
    const bodyText = await res.text();
    let rows = 0;
    try {
      const parsed = JSON.parse(bodyText);
      rows = Array.isArray(parsed.rows) ? parsed.rows.length : 0;
    } catch {
      // ignore parse errors
    }
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs,
      shipmentID: shipment.shipmentID,
      warehouse: shipment.warehouse,
      rows,
      error: res.ok ? null : bodyText.slice(0, 120),
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: 0,
      elapsedMs: performance.now() - start,
      shipmentID: shipment.shipmentID,
      warehouse: shipment.warehouse,
      rows: 0,
      error: err.message,
    };
  }
}

async function runBatch(shipments) {
  return Promise.all(shipments.map((s) => callWorker(s)));
}

async function main() {
  const verbose = COUNT <= 200;
  log(`Fetching shipment pool from ils...`);
  const pool = await fetchShipmentPool();
  if (pool.length === 0) {
    console.error("No shipments found in database.");
    process.exit(1);
  }
  const shipments = buildShipmentList(pool, COUNT);
  log(`Pool: ${pool.length} shipments, running ${COUNT} API calls (concurrency ${CONCURRENCY})...`);
  log(`Orchestrator: ${BASE_URL}`);
  if (verbose) log("---");

  const wallStart = performance.now();
  const results = [];

  for (let i = 0; i < shipments.length; i += CONCURRENCY) {
    const batch = shipments.slice(i, i + CONCURRENCY);
    const batchResults = await runBatch(batch);
    results.push(...batchResults);

    if (verbose) {
      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        const n = i + j + 1;
        const status = r.ok ? "OK" : "ERR";
        log(
          `#${String(n).padStart(3)} ${status} ${r.elapsedMs.toFixed(1)}ms ` +
            `shipment=${r.shipmentID} warehouse=${r.warehouse} rows=${r.rows}` +
            (r.error ? ` error=${r.error}` : "")
        );
      }
    } else if (results.length % 1000 < CONCURRENCY || results.length === shipments.length) {
      const batchErrors = batchResults.filter((r) => !r.ok).length;
      log(`Progress: ${results.length}/${COUNT} (${((results.length / COUNT) * 100).toFixed(1)}%) batchErrors=${batchErrors}`);
    }
  }

  const wallMs = performance.now() - wallStart;
  const times = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const success = results.filter((r) => r.ok).length;
  const errors = results.length - success;

  log("---");
  log("Summary:");
  log(`  Total calls:   ${results.length}`);
  log(`  Success:       ${success}`);
  log(`  Errors:        ${errors}`);
  log(`  Wall time:     ${(wallMs / 1000).toFixed(2)}s`);
  log(`  Throughput:    ${(results.length / (wallMs / 1000)).toFixed(2)} req/s`);
  log(`  Latency min:   ${times[0]?.toFixed(1)}ms`);
  log(`  Latency p50:   ${percentile(times, 50).toFixed(1)}ms`);
  log(`  Latency p95:   ${percentile(times, 95).toFixed(1)}ms`);
  log(`  Latency max:   ${times[times.length - 1]?.toFixed(1)}ms`);
  log(`  Latency avg:   ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
