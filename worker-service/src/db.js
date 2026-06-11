const sql = require("mssql");
const {
  buildMssqlConfig,
  formatConnectionTarget,
} = require("../config/database");

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(buildMssqlConfig({ pool: {} }));
    console.log(`[WORKER] SQL pool connected: ${formatConnectionTarget()}`);
  }
  return pool;
}

function applyParams(request, paramDefs, values) {
  for (const [name, typeName] of Object.entries(paramDefs)) {
    const sqlType = sql[typeName];
    if (!sqlType) {
      throw new Error(`Unsupported SQL param type: ${typeName}`);
    }
    request.input(name, sqlType, values[name]);
  }
}

async function runNamedQuery(queryDef, params = {}) {
  const poolConn = await getPool();
  const request = poolConn.request();
  applyParams(request, queryDef.params, params);
  const result = await request.query(queryDef.sql);
  return {
    rowCount: result.rowsAffected.reduce((sum, n) => sum + n, 0),
    rows: result.recordset,
  };
}

module.exports = {
  getPool,
  runNamedQuery,
};
