#!/usr/bin/env node
/**
 * Query Demonstration
 * Runs example queries and shows EXPLAIN output to demonstrate
 * the difference between regular PostgreSQL and Citus distributed execution
 */

const { getClient, runQuery, runExplainAnalyze } = require('./utils/sql-runner');
const { isCitusEnabled, printShardStats } = require('./utils/shard-stats');

const QUERY_TYPE = process.argv[2] || 'all';

async function runSingleShardQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('SINGLE-SHARD QUERIES');
  console.log('═'.repeat(60));
  console.log('These queries filter by user_id (distribution column)');
  console.log('In Citus: Routes to a single worker\n');

  // Simple select
  await runExplainAnalyze(client,
    'SELECT * FROM orders WHERE user_id = 42 LIMIT 5',
    'Orders for user 42'
  );

  // Aggregation on single user
  const { result: userStats } = await runQuery(client, `
    SELECT COUNT(*) as orders, SUM(amount) as total, AVG(amount) as avg
    FROM orders WHERE user_id = 42
  `);
  console.log('\nUser 42 Statistics:');
  console.table(userStats.rows);

  // Colocated join
  await runExplainAnalyze(client,
    `SELECT o.id, o.amount, oi.product_name
     FROM orders o
     JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
     WHERE o.user_id = 42 LIMIT 5`,
    'Colocated join (orders + order_items)'
  );
}

async function runCrossShardQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('CROSS-SHARD QUERIES (Multi-Shard)');
  console.log('═'.repeat(60));
  console.log('These queries execute in parallel across all workers\n');

  // Total count
  await runExplainAnalyze(client,
    'SELECT COUNT(*) FROM orders',
    'Total order count'
  );

  // Group by region
  const { result: regionStats } = await runQuery(client, `
    SELECT region, COUNT(*) as orders, SUM(amount) as revenue
    FROM orders GROUP BY region ORDER BY revenue DESC
  `);
  console.log('\nRevenue by Region:');
  console.table(regionStats.rows);

  // Group by status
  await runExplainAnalyze(client,
    `SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY COUNT(*) DESC`,
    'Orders by status'
  );
}

async function runJoinQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('JOIN QUERIES');
  console.log('═'.repeat(60));

  // Reference table join
  console.log('\n--- Reference Table Join (regions) ---');
  await runExplainAnalyze(client,
    `SELECT o.id, o.amount, r.name as region_name, r.currency
     FROM orders o JOIN regions r ON o.region = r.code
     WHERE o.user_id = 42 LIMIT 5`,
    'Reference table join'
  );

  // Local table join
  console.log('\n--- Local Table Join (users) ---');
  await runExplainAnalyze(client,
    `SELECT o.id, o.amount, u.email, u.tier
     FROM orders o JOIN users u ON o.user_id = u.id
     WHERE o.user_id = 42 LIMIT 5`,
    'Local table join'
  );

  // Multi-table join
  console.log('\n--- Multi-Table Join ---');
  const { result: multiJoin } = await runQuery(client, `
    SELECT
      o.id as order_id,
      u.email,
      r.name as region,
      o.amount,
      COUNT(oi.id) as items
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN regions r ON o.region = r.code
    LEFT JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
    WHERE o.user_id = 42
    GROUP BY o.id, u.email, r.name, o.amount
    ORDER BY o.id
    LIMIT 5
  `);
  console.log('\nMulti-table join results:');
  console.table(multiJoin.rows);
}

async function runAggregateQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('AGGREGATE QUERIES');
  console.log('═'.repeat(60));

  // Overall stats
  const { result: overallStats } = await runQuery(client, `
    SELECT
      COUNT(*) as total_orders,
      COUNT(DISTINCT user_id) as unique_users,
      SUM(amount) as total_revenue,
      AVG(amount) as avg_order_value,
      MIN(amount) as min_order,
      MAX(amount) as max_order
    FROM orders
  `);
  console.log('\nOverall Statistics:');
  console.table(overallStats.rows);

  // Top users
  const { result: topUsers } = await runQuery(client, `
    SELECT user_id, COUNT(*) as orders, SUM(amount) as total_spent
    FROM orders
    GROUP BY user_id
    ORDER BY orders DESC
    LIMIT 10
  `);
  console.log('\nTop 10 Users by Order Count:');
  console.table(topUsers.rows);

  // Orders over time (by date if data spans multiple days)
  const { result: recentOrders } = await runQuery(client, `
    SELECT
      DATE(created_at) as date,
      COUNT(*) as orders,
      SUM(amount) as revenue
    FROM orders
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 7
  `);
  console.log('\nOrders by Date:');
  console.table(recentOrders.rows);
}

async function main() {
  console.log('═'.repeat(60));
  console.log('QUERY DEMONSTRATION');
  console.log('═'.repeat(60));

  const client = await getClient();

  try {
    // Check if Citus is enabled
    const citusActive = await isCitusEnabled(client);
    console.log(`\nCitus Status: ${citusActive ? 'ENABLED (distributed)' : 'NOT ENABLED (regular PostgreSQL)'}`);

    if (citusActive) {
      console.log('Queries will execute across distributed workers.');
    } else {
      console.log('Queries will execute on single PostgreSQL instance.');
    }

    // Print shard stats if Citus is enabled
    if (citusActive) {
      await printShardStats(client);
    }

    // Run requested query types
    const types = QUERY_TYPE === 'all'
      ? ['single-shard', 'cross-shard', 'join', 'aggregate']
      : [QUERY_TYPE];

    for (const type of types) {
      switch (type) {
        case 'single-shard':
          await runSingleShardQueries(client);
          break;
        case 'cross-shard':
          await runCrossShardQueries(client);
          break;
        case 'join':
          await runJoinQueries(client);
          break;
        case 'aggregate':
          await runAggregateQueries(client);
          break;
        default:
          console.log(`Unknown query type: ${type}`);
          console.log('Valid types: single-shard, cross-shard, join, aggregate, all');
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('Query demonstration complete.');
    console.log('═'.repeat(60) + '\n');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
