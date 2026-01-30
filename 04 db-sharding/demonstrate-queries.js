#!/usr/bin/env node
/**
 * Query Demonstration
 * Runs example queries and shows EXPLAIN output to demonstrate
 * the difference between regular PostgreSQL and Citus distributed execution
 */

const { getClient, runQuery, runExplainAnalyze } = require('./utils/sql-runner');
const { isCitusEnabled, printShardStats } = require('./utils/shard-stats');

const QUERY_TYPE = process.argv[2] || 'all';

// Array to collect query performance data
const queryResults = [];

async function runSingleShardQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('SINGLE-SHARD QUERIES');
  console.log('═'.repeat(60));
  console.log('These queries filter by user_id (distribution column)');
  console.log('In Citus: Routes to a single worker\n');

  // Simple select
  const { duration: ordersForUser42Duration } = await runExplainAnalyze(client,
    'SELECT * FROM orders WHERE user_id = 42 LIMIT 5',
    'Orders for user 42'
  );
  queryResults.push({ title: 'Orders for user 42', duration: ordersForUser42Duration });

  // Aggregation on single user
  const { result: userStats, duration: userStatsDuration } = await runQuery(client, `
    SELECT COUNT(*) as orders, SUM(amount) as total, AVG(amount) as avg
    FROM orders WHERE user_id = 42
  `);
  console.log('\nUser 42 Statistics:');
  console.table(userStats.rows);
  console.log(`Query Duration: ${userStatsDuration} ms`);
  queryResults.push({ title: 'User 42 Statistics', duration: userStatsDuration });

  // Colocated join
  const { duration: colocatedJoinDuration } = await runExplainAnalyze(client,
    `SELECT o.id, o.amount, oi.product_name
     FROM orders o
     JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
     WHERE o.user_id = 42 LIMIT 5`,
    'Colocated join (orders + order_items)'
  );
  queryResults.push({ title: 'Colocated join (orders + order_items)', duration: colocatedJoinDuration });
}

async function runCrossShardQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('CROSS-SHARD QUERIES (Multi-Shard)');
  console.log('═'.repeat(60));
  console.log('These queries execute in parallel across all workers\n');

  // Total count
  const { duration: totalCountDuration } = await runExplainAnalyze(client,
    'SELECT COUNT(*) FROM orders',
    'Total order count'
  );
  queryResults.push({ title: 'Total order count', duration: totalCountDuration });

  // Group by region
  const { result: regionStats, duration: regionStatsDuration } = await runQuery(client, `
    SELECT region, COUNT(*) as orders, SUM(amount) as revenue
    FROM orders GROUP BY region ORDER BY revenue DESC
  `);
  console.log('\nRevenue by Region:');
  console.table(regionStats.rows);
  console.log(`Query Duration: ${regionStatsDuration} ms`);
  queryResults.push({ title: 'Revenue by Region', duration: regionStatsDuration });

  // Group by status
  const { duration: ordersByStatusDuration } = await runExplainAnalyze(client,
    `SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY COUNT(*) DESC`,
    'Orders by status'
  );
  queryResults.push({ title: 'Orders by status', duration: ordersByStatusDuration });
}

async function runJoinQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('JOIN QUERIES');
  console.log('═'.repeat(60));

  // Reference table join
  console.log('\n--- Reference Table Join (regions) ---');
  const { duration: refTableJoinDuration } = await runExplainAnalyze(client,
    `SELECT o.id, o.amount, r.name as region_name, r.currency
     FROM orders o JOIN regions r ON o.region = r.code
     WHERE o.user_id = 42 LIMIT 5`,
    'Reference table join'
  );
  queryResults.push({ title: 'Reference table join', duration: refTableJoinDuration });

  // Local table join
  console.log('\n--- Local Table Join (users) ---');
  const { duration: localTableJoinDuration } = await runExplainAnalyze(client,
    `SELECT o.id, o.amount, u.email, u.tier
     FROM orders o JOIN users u ON o.user_id = u.id
     WHERE o.user_id = 42 LIMIT 5`,
    'Local table join'
  );
  queryResults.push({ title: 'Local table join', duration: localTableJoinDuration });

  // Multi-table join
  console.log('\n--- Multi-Table Join ---');
  const { result: multiJoin, duration: multiJoinDuration } = await runQuery(client, `
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
  console.log(`Query Duration: ${multiJoinDuration} ms`);
  queryResults.push({ title: 'Multi-table join', duration: multiJoinDuration });
}

async function runAggregateQueries(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('AGGREGATE QUERIES');
  console.log('═'.repeat(60));

  // Overall stats
  const { result: overallStats, duration: overallStatsDuration } = await runQuery(client, `
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
  console.log(`Query Duration: ${overallStatsDuration} ms`);
  queryResults.push({ title: 'Overall Statistics', duration: overallStatsDuration });

  // Top users
  const { result: topUsers, duration: topUsersDuration } = await runQuery(client, `
    SELECT user_id, COUNT(*) as orders, SUM(amount) as total_spent
    FROM orders
    GROUP BY user_id
    ORDER BY orders DESC
    LIMIT 10
  `);
  console.log('\nTop 10 Users by Order Count:');
  console.table(topUsers.rows);
  queryResults.push({ title: 'Top 10 Users by Order Count', duration: topUsersDuration });

  // Orders over time (by date if data spans multiple days)
  const { result: recentOrders, duration: recentOrdersDuration } = await runQuery(client, `
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
  console.log(`Query Duration: ${recentOrdersDuration} ms`);
  queryResults.push({ title: 'Orders by Date', duration: recentOrdersDuration });
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

    // Display summary table
    if (queryResults.length > 0) {
      console.log('\n' + '═'.repeat(60));
      console.log('QUERY PERFORMANCE SUMMARY');
      console.log('═'.repeat(60) + '\n');
      
      // Format results for table display
      const summaryTable = queryResults.map((query, index) => ({
        '#': index + 1,
        'Title': query.title,
        'Duration (ms)': query.duration.toFixed(2)
      }));
      
      console.table(summaryTable);
      
      // Calculate total time
      const totalTime = queryResults.reduce((sum, query) => sum + query.duration, 0);
      console.log(`\nTotal Time: ${totalTime.toFixed(2)} ms\n`);
    }

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
