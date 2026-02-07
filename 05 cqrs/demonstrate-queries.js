#!/usr/bin/env node
/**
 * Query Demonstration
 * Runs analytics queries against both normalized tables and read models,
 * with timing comparison and EXPLAIN ANALYZE output.
 */

const { getClient, runQuery, runExplainAnalyze } = require('./utils/sql-runner');
const { getCurrentStrategy, printCqrsStats } = require('./utils/cqrs-stats');
const { REGIONS, selectUserForOrder, randomInt, randomElement, randomDecimal } = require('./utils/data-generator');
const { config } = require('./utils/config');

const queryResults = [];

// ─── Baseline Queries (JOINs on normalized tables) ────────────────────

const BASELINE_QUERIES = {
  revenueByRegion: `
    SELECT o.region, COUNT(*) AS order_count,
           SUM(o.total_amount) AS total_revenue,
           AVG(o.total_amount) AS avg_order_value
    FROM orders o WHERE o.status != 'cancelled'
    GROUP BY o.region ORDER BY total_revenue DESC`,

  topProducts: `
    SELECT p.id AS product_id, p.name AS product_name, p.category,
           SUM(oi.quantity) AS total_sold, SUM(oi.line_total) AS total_revenue
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY p.id, p.name, p.category
    ORDER BY total_revenue DESC LIMIT 10`,

  topSpenders: `
    SELECT u.id AS user_id, u.name, u.region_code, u.tier,
           COUNT(o.id) AS order_count, SUM(o.total_amount) AS total_spent,
           AVG(o.total_amount) AS avg_order_value
    FROM users u JOIN orders o ON u.id = o.user_id
    WHERE o.status != 'cancelled'
    GROUP BY u.id, u.name, u.region_code, u.tier
    ORDER BY total_spent DESC LIMIT 20`,

  dailyStats: `
    SELECT DATE(o.created_at) AS stat_date, COUNT(*) AS order_count,
           SUM(o.total_amount) AS total_revenue,
           COUNT(DISTINCT o.user_id) AS unique_customers,
           AVG(o.total_amount) AS avg_order_value
    FROM orders o WHERE o.status != 'cancelled'
    GROUP BY DATE(o.created_at)
    ORDER BY stat_date DESC LIMIT 30`,
};

// ─── Read Model Queries ───────────────────────────────────────────────

function getReadModelQueries(strategy) {
  const prefix = strategy === 'materialized_views' ? 'mv_' : 'read_';
  const revenueTable = strategy === 'materialized_views' ? 'mv_revenue_by_region' : 'read_revenue_by_region';
  const productsTable = strategy === 'materialized_views' ? 'mv_top_products' : 'read_top_products';
  const spendingTable = strategy === 'materialized_views' ? 'mv_user_spending' : 'read_user_spending';
  const dailyTable = strategy === 'materialized_views' ? 'mv_daily_stats' : 'read_daily_stats';

  return {
    revenueByRegion: `SELECT * FROM ${revenueTable} ORDER BY total_revenue DESC`,
    topProducts: `SELECT * FROM ${productsTable} ORDER BY total_revenue DESC LIMIT 10`,
    topSpenders: `SELECT * FROM ${spendingTable} ORDER BY total_spent DESC LIMIT 20`,
    dailyStats: `SELECT * FROM ${dailyTable} ORDER BY stat_date DESC LIMIT 30`,
  };
}

// ─── Run baseline analytics ───────────────────────────────────────────

async function runBaselineQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('BASELINE QUERIES (JOINs on normalized tables)');
  console.log('═'.repeat(60));

  const labels = {
    revenueByRegion: 'Revenue by Region',
    topProducts: 'Top 10 Products',
    topSpenders: 'Top 20 Spenders',
    dailyStats: 'Daily Stats (30 days)',
  };

  const results = {};

  for (const [key, query] of Object.entries(BASELINE_QUERIES)) {
    const { duration } = await runExplainAnalyze(client, query, labels[key]);
    results[key] = duration;
    queryResults.push({
      query: labels[key],
      baseline_ms: duration,
      read_model_ms: null,
      speedup: null,
    });
  }

  return results;
}

// ─── Run read model analytics ─────────────────────────────────────────

async function runReadModelQueries(client, strategy) {
  const strategyLabel = {
    materialized_views: 'Materialized Views',
    triggers: 'Trigger-Based Read Tables',
    listen_notify: 'NOTIFY Read Tables',
  }[strategy] || strategy;

  console.log('\n' + '═'.repeat(60));
  console.log(`READ MODEL QUERIES (${strategyLabel})`);
  console.log('═'.repeat(60));

  const queries = getReadModelQueries(strategy);
  const labels = {
    revenueByRegion: 'Revenue by Region',
    topProducts: 'Top 10 Products',
    topSpenders: 'Top 20 Spenders',
    dailyStats: 'Daily Stats (30 days)',
  };

  const results = {};

  for (const [key, query] of Object.entries(queries)) {
    const { duration } = await runExplainAnalyze(client, query, `${labels[key]} [READ MODEL]`);
    results[key] = duration;
  }

  return results;
}

// ─── Write benchmark ──────────────────────────────────────────────────

async function runWriteBenchmark(client, count = 1000) {
  console.log('\n' + '═'.repeat(60));
  console.log(`WRITE BENCHMARK: Insert ${count} orders`);
  console.log('═'.repeat(60));

  // Get a valid user for inserting orders
  const { result: userRow } = await runQuery(client, `SELECT id, region_code FROM users LIMIT 1`);
  const userId = userRow.rows[0].id;
  const region = userRow.rows[0].region_code;

  const start = Date.now();

  for (let i = 0; i < count; i++) {
    const amount = randomDecimal(10, 2000);
    await runQuery(client, `
      INSERT INTO orders (user_id, region, status, total_amount)
      VALUES ($1, $2, 'completed', $3) RETURNING id
    `, [userId, region, amount]);
  }

  const duration = Date.now() - start;
  const avgPerInsert = (duration / count).toFixed(2);

  console.log(`\n  Total: ${duration}ms for ${count} inserts`);
  console.log(`  Average: ${avgPerInsert}ms per INSERT`);

  return { total_ms: duration, avg_ms: parseFloat(avgPerInsert), count };
}

// ─── Freshness check ──────────────────────────────────────────────────

async function runFreshnessCheck(client, strategy) {
  if (strategy === 'none') return;

  console.log('\n' + '═'.repeat(60));
  console.log('FRESHNESS CHECK: Insert + Immediate Read');
  console.log('═'.repeat(60));

  // Get a user
  const { result: userRow } = await runQuery(client, `SELECT id, region_code FROM users LIMIT 1`);
  const userId = userRow.rows[0].id;
  const region = userRow.rows[0].region_code;

  // Read before
  let readQuery;
  if (strategy === 'materialized_views') {
    readQuery = `SELECT total_revenue FROM mv_revenue_by_region WHERE region = $1`;
  } else {
    readQuery = `SELECT total_revenue FROM read_revenue_by_region WHERE region = $1`;
  }

  const { result: before } = await runQuery(client, readQuery, [region]);
  const revenueBefore = before.rows[0]?.total_revenue || 0;
  console.log(`\n  Revenue for ${region} BEFORE insert: ${revenueBefore}`);

  // Insert a large order
  const amount = 99999.99;
  await runQuery(client, `
    INSERT INTO orders (user_id, region, status, total_amount)
    VALUES ($1, $2, 'completed', $3)
  `, [userId, region, amount]);
  console.log(`  Inserted order: $${amount} in ${region}`);

  // Read immediately after
  const { result: after } = await runQuery(client, readQuery, [region]);
  const revenueAfter = after.rows[0]?.total_revenue || 0;
  console.log(`  Revenue for ${region} AFTER insert:  ${revenueAfter}`);

  const isReflected = parseFloat(revenueAfter) > parseFloat(revenueBefore);
  console.log(`  Change reflected immediately: ${isReflected ? 'YES ✓' : 'NO (stale)'}`);

  if (strategy === 'materialized_views' && !isReflected) {
    console.log('  → Expected for mat views. Run "npm run refresh" to update.');
  } else if (strategy === 'listen_notify' && !isReflected) {
    console.log('  → Expected for NOTIFY. Worker will sync within batch interval.');
  }
}

// ─── Summary table ────────────────────────────────────────────────────

function printSummary(baselineResults, readModelResults, writeBenchmark, strategy) {
  console.log('\n' + '═'.repeat(60));
  console.log('PERFORMANCE COMPARISON SUMMARY');
  console.log('═'.repeat(60));

  const labels = {
    revenueByRegion: 'Revenue by Region',
    topProducts: 'Top 10 Products',
    topSpenders: 'Top 20 Spenders',
    dailyStats: 'Daily Stats (30 days)',
  };

  console.log('\nRead Performance:');
  console.log('─'.repeat(50));

  const summaryRows = [];
  for (const key of Object.keys(labels)) {
    const baseline = baselineResults[key];
    const readModel = readModelResults ? readModelResults[key] : null;
    const hasReadModel = readModel !== null && readModel !== undefined;
    const speedup = hasReadModel && readModel > 0 ? (baseline / readModel).toFixed(1) : hasReadModel ? '∞' : 'N/A';

    summaryRows.push({
      Query: labels[key],
      'Baseline (ms)': baseline,
      'Read Model (ms)': hasReadModel ? readModel : 'N/A',
      Speedup: hasReadModel ? `${speedup}x` : 'N/A',
    });
  }
  console.table(summaryRows);

  if (writeBenchmark) {
    console.log('\nWrite Performance:');
    console.log('─'.repeat(50));
    console.log(`  ${writeBenchmark.count} INSERTs: ${writeBenchmark.total_ms}ms total, ${writeBenchmark.avg_ms}ms avg`);
  }

  const strategyLabel = {
    none: 'Baseline (no CQRS)',
    materialized_views: 'Phase 2: Materialized Views',
    triggers: 'Phase 3: Trigger-Based Sync',
    listen_notify: 'Phase 4: LISTEN/NOTIFY',
  }[strategy] || strategy;

  console.log(`\nCurrent Strategy: ${strategyLabel}`);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('CQRS QUERY DEMONSTRATION');
  console.log('═'.repeat(60));

  const client = await getClient();

  try {
    const strategy = await getCurrentStrategy(client);
    console.log(`\nCurrent Strategy: ${strategy}`);

    await printCqrsStats(client);

    // Run baseline queries
    const baselineResults = await runBaselineQueries(client);

    // Run read model queries if a strategy is active
    let readModelResults = null;
    if (strategy !== 'none') {
      readModelResults = await runReadModelQueries(client, strategy);
    }

    // Write benchmark
    const writeBenchmark = await runWriteBenchmark(client);

    // Freshness check
    await runFreshnessCheck(client, strategy);

    // Summary
    printSummary(baselineResults, readModelResults, writeBenchmark, strategy);

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
