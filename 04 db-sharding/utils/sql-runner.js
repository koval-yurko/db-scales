const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

async function getClient(connectionConfig = config.coordinator) {
  const client = new Client(connectionConfig);
  await client.connect();
  return client;
}

async function runQuery(client, query, params = []) {
  const start = Date.now();
  const result = await client.query(query, params);
  const duration = Date.now() - start;
  return { result, duration };
}

async function runSqlFile(client, filePath) {
  const absolutePath = path.resolve(__dirname, '..', filePath);
  const sql = fs.readFileSync(absolutePath, 'utf8');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Executing: ${filePath}`);
  console.log('='.repeat(60));

  // Split by semicolons followed by newline (safer for multi-statement files)
  const rawStatements = sql.split(/;\s*\n/);

  const statements = rawStatements
    .map(s => {
      // Remove leading comment lines
      const lines = s.split('\n');
      while (lines.length > 0 && lines[0].trim().startsWith('--')) {
        lines.shift();
      }
      return lines.join('\n').trim();
    })
    .filter(s => s.length > 0);

  for (const statement of statements) {
    if (!statement) continue;

    // Skip pure comment blocks
    const withoutComments = statement.replace(/--.*$/gm, '').trim();
    if (!withoutComments) continue;

    try {
      const { result, duration } = await runQuery(client, statement);

      // Show first line of statement for context
      const firstLine = statement.split('\n')[0].substring(0, 60);
      console.log(`\n> ${firstLine}${statement.length > 60 ? '...' : ''}`);
      console.log(`  Duration: ${duration}ms, Rows: ${result.rowCount ?? result.rows?.length ?? 0}`);

      // Show results for SELECT queries
      if (result.rows && result.rows.length > 0 && result.rows.length <= 20) {
        console.table(result.rows);
      } else if (result.rows && result.rows.length > 20) {
        console.log(`  (${result.rows.length} rows returned, showing first 10)`);
        console.table(result.rows.slice(0, 10));
      }
    } catch (err) {
      console.error(`\nError executing statement:`);
      console.error(statement.substring(0, 200));
      console.error(`Error: ${err.message}`);
      throw err;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Completed: ${filePath}`);
  console.log('='.repeat(60));
}

async function runExplainAnalyze(client, query, label = 'Query') {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`EXPLAIN ANALYZE: ${label}`);
  console.log('─'.repeat(60));
  console.log(`Query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}`);

  const explainQuery = `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT TEXT) ${query}`;
  const { result, duration } = await runQuery(client, explainQuery);

  console.log(`\nExecution Plan:`);
  result.rows.forEach(row => console.log(row['QUERY PLAN']));
  console.log(`\nTotal time: ${duration}ms`);

  return result;
}

module.exports = {
  getClient,
  runQuery,
  runSqlFile,
  runExplainAnalyze,
};
