const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

async function getClient(connectionConfig = config.db) {
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

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    // Count $$ occurrences in this line (outside of already-being-in-dollar-quote context)
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarQuote = !inDollarQuote;
      }
    }

    current += line + '\n';

    // If we're not inside a $$ block, check for statement-ending semicolons
    if (!inDollarQuote) {
      const trimmed = line.trim();
      if (trimmed.endsWith(';')) {
        const stmt = current.trim().replace(/;$/, '').trim();
        // Strip leading comment-only lines
        const stmtLines = stmt.split('\n');
        while (stmtLines.length > 0 && stmtLines[0].trim().startsWith('--')) {
          stmtLines.shift();
        }
        const cleaned = stmtLines.join('\n').trim();
        if (cleaned.length > 0) {
          statements.push(cleaned);
        }
        current = '';
      }
    }
  }

  // Handle any remaining text (statement without trailing semicolon)
  const remainder = current.trim();
  if (remainder.length > 0) {
    const withoutComments = remainder.replace(/--.*$/gm, '').trim();
    if (withoutComments.length > 0) {
      statements.push(remainder);
    }
  }

  return statements;
}

async function runSqlFile(client, filePath) {
  const absolutePath = path.resolve(__dirname, '..', filePath);
  const sql = fs.readFileSync(absolutePath, 'utf8');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Executing: ${filePath}`);
  console.log('═'.repeat(60));

  // Split SQL into statements, respecting $$ delimited blocks
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    if (!statement) continue;

    const withoutComments = statement.replace(/--.*$/gm, '').trim();
    if (!withoutComments) continue;

    try {
      const { result, duration } = await runQuery(client, statement);
      const firstLine = statement.split('\n')[0].substring(0, 60);
      console.log(`\n> ${firstLine}${statement.length > 60 ? '...' : ''}`);
      console.log(`  Duration: ${duration}ms, Rows: ${result.rowCount ?? result.rows?.length ?? 0}`);

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

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Completed: ${filePath}`);
  console.log('═'.repeat(60));
}

async function runExplainAnalyze(client, query, label = 'Query') {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`EXPLAIN ANALYZE: ${label}`);
  console.log('─'.repeat(60));
  console.log(`Query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}`);

  const explainQuery = `EXPLAIN (ANALYZE, COSTS, BUFFERS, FORMAT TEXT) ${query}`;
  const { result, duration } = await runQuery(client, explainQuery);

  console.log(`\nExecution Plan:`);
  result.rows.forEach(row => console.log(row['QUERY PLAN']));
  console.log(`\nTotal time: ${duration}ms`);

  return { result, duration };
}

module.exports = { getClient, runQuery, runSqlFile, runExplainAnalyze };
