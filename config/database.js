const path = require("path");
const fs = require("fs");

function loadDotEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) return;
  try {
    require("dotenv").config({ path: envPath });
  } catch {
    // dotenv optional; fall back to process.env / defaults
  }
}

loadDotEnv();

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === "true" || raw === "1";
}

function envInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

function getDatabaseSettings() {
  return {
    server: process.env.DB_SERVER || "192.168.123.242",
    port: process.env.DB_PORT ? envInt("DB_PORT", 1433) : 1433,
    instance: process.env.DB_INSTANCE || "",
    database: process.env.DB_NAME || "ils",
    user: process.env.DB_USER || "manh",
    password: process.env.DB_PASSWORD || "manh",
    encrypt: envBool("DB_ENCRYPT", false),
    trustServerCertificate: envBool("DB_TRUST_SERVER_CERTIFICATE", true),
    poolMax: envInt("DB_POOL_MAX", 20),
    requestTimeoutMs: envInt("DB_REQUEST_TIMEOUT_MS", 30000),
    connectionTimeoutMs: envInt("DB_CONNECTION_TIMEOUT_MS", 15000),
  };
}

function buildMssqlConfig(overrides = {}) {
  const s = getDatabaseSettings();
  const config = {
    server: s.server,
    database: s.database,
    user: s.user,
    password: s.password,
    options: {
      encrypt: s.encrypt,
      trustServerCertificate: s.trustServerCertificate,
      enableArithAbort: true,
    },
    requestTimeout: overrides.requestTimeoutMs ?? s.requestTimeoutMs,
    connectionTimeout: overrides.connectionTimeoutMs ?? s.connectionTimeoutMs,
  };

  if (overrides.pool) {
    config.pool = {
      max: s.poolMax,
      min: 0,
      idleTimeoutMillis: 30000,
      ...overrides.pool,
    };
  }

  if (s.port) {
    config.port = s.port;
  } else if (s.instance) {
    config.options.instanceName = s.instance;
  }

  return config;
}

function formatConnectionTarget() {
  const s = getDatabaseSettings();
  const host = s.port ? `${s.server}:${s.port}` : `${s.server}\\${s.instance || "SQL2022DEV"}`;
  return `${host}/${s.database}`;
}

function diagnoseConnectionError(err) {
  const s = getDatabaseSettings();
  const msg = err.message || String(err);
  if (/ETIMEOUT|ECONNREFUSED|ENOTFOUND|ESOCKET|Failed to connect/i.test(msg)) {
    return [
      "Network/instance discovery failed.",
      "- Ensure SQL Server TCP/IP is enabled for the instance.",
      "- Set a static TCP port (DB_PORT) or start SQL Server Browser (UDP 1434).",
      "- Open the TCP port in Windows Firewall.",
      "- Check DB_SERVER / DB_PORT in .env",
    ].join("\n  ");
  }
  if (/Login failed|ELOGIN/i.test(msg)) {
    return "Authentication failed. Check DB_USER / DB_PASSWORD in .env.";
  }
  if (/Cannot open database/i.test(msg)) {
    return `Database '${s.database}' is not accessible for this login. Check DB_NAME and permissions.`;
  }
  return msg;
}

module.exports = {
  getDatabaseSettings,
  buildMssqlConfig,
  formatConnectionTarget,
  diagnoseConnectionError,
};
