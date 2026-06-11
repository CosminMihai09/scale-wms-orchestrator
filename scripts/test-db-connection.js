#!/usr/bin/env node
/**
 * Test SQL Server connectivity from the host machine.
 * Reads connection settings from .env via config/database.js
 *
 * Usage: node scripts/test-db-connection.js
 */

const sql = require("mssql");
const {
  buildMssqlConfig,
  formatConnectionTarget,
  diagnoseConnectionError,
  getDatabaseSettings,
} = require("../config/database");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const { user } = getDatabaseSettings();
  log(`Connecting to ${formatConnectionTarget()} as ${user}...`);

  try {
    const pool = await sql.connect(buildMssqlConfig());
    const versionResult = await pool.request().query("SELECT @@VERSION AS version");
    const dbResult = await pool.request().query("SELECT DB_NAME() AS databaseName");
    const pingResult = await pool.request().query("SELECT 1 AS ok");

    log("Connection successful.");
    log(`  Database: ${dbResult.recordset[0].databaseName}`);
    log(`  Ping:     ${pingResult.recordset[0].ok}`);
    log(`  Version:  ${versionResult.recordset[0].version.split("\n")[0]}`);
    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error("\nConnection failed:");
    console.error(`  ${diagnoseConnectionError(err)}\n`);
    process.exit(1);
  }
}

main();
