const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { config } = require('./config');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool(config.db);
  }
  return pool;
}

async function runSQL(filePath, label) {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, '..', filePath);

  const sql = fs.readFileSync(fullPath, 'utf8');
  const name = label || path.basename(filePath);

  console.log(`  Running: ${name}...`);
  const start = Date.now();
  const result = await getPool().query(sql);
  const duration = Date.now() - start;
  console.log(`  Done: ${name} (${duration}ms)`);

  return { result, duration, name };
}

async function query(sql, params) {
  return getPool().query(sql, params);
}

async function timedQuery(sql, params, label) {
  const start = Date.now();
  const result = await getPool().query(sql, params);
  const duration = Date.now() - start;
  return { result, duration, label };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { runSQL, query, timedQuery, closePool, getPool };
