const { Client } = require('pg');
const config = require('./utils/config');
const { showExplain } = require('./utils/query-executor');
const { getPartitionStats } = require('./utils/partition-stats');

async function demonstrateRangePartitioning(client) {
  console.log('\n');
  console.log('='.repeat(80));
  console.log('RANGE PARTITIONING - event_logs (partitioned by created_at)');
  console.log('='.repeat(80));

  await getPartitionStats(client, 'event_logs');

  console.log('\n--- Query: Events in January 2024 (single partition scan) ---\n');
  await showExplain(client, `
    SELECT * FROM event_logs
    WHERE created_at >= '2024-01-01' AND created_at < '2024-02-01'
  `);

  console.log('\n--- Query: Events in Feb-Mar 2024 (two partition scan) ---\n');
  await showExplain(client, `
    SELECT * FROM event_logs
    WHERE created_at >= '2024-02-01' AND created_at < '2024-04-01'
  `);
}

async function demonstrateHashPartitioning(client) {
  console.log('\n');
  console.log('='.repeat(80));
  console.log('HASH PARTITIONING - users_distributed (partitioned by id)');
  console.log('='.repeat(80));

  await getPartitionStats(client, 'users_distributed');

  console.log('\n--- Query: Lookup by specific ID (single partition scan) ---\n');
  await showExplain(client, `
    SELECT * FROM users_distributed
    WHERE id = 42
  `);

  console.log('\n--- Query: Range of IDs (multiple partition scan) ---\n');
  await showExplain(client, `
    SELECT * FROM users_distributed
    WHERE id BETWEEN 1 AND 100
  `);
}

async function demonstrateListPartitioning(client) {
  console.log('\n');
  console.log('='.repeat(80));
  console.log('LIST PARTITIONING - orders_by_region (partitioned by region)');
  console.log('='.repeat(80));

  await getPartitionStats(client, 'orders_by_region');

  console.log('\n--- Query: Orders in North America (single partition scan) ---\n');
  await showExplain(client, `
    SELECT * FROM orders_by_region
    WHERE region = 'north_america'
  `);

  console.log('\n--- Query: Orders in Europe or Asia (two partition scan) ---\n');
  await showExplain(client, `
    SELECT * FROM orders_by_region
    WHERE region IN ('europe', 'asia_pacific')
  `);
}

async function demonstrateCompositePartitioning(client) {
  console.log('\n');
  console.log('='.repeat(80));
  console.log('COMPOSITE PARTITIONING - sales_data (RANGE by date, LIST by category)');
  console.log('='.repeat(80));

  await getPartitionStats(client, 'sales_data');

  console.log('\n--- Query: Q1 Electronics (single leaf partition) ---\n');
  await showExplain(client, `
    SELECT * FROM sales_data
    WHERE sale_date >= '2024-01-01' AND sale_date < '2024-04-01'
      AND category = 'electronics'
  `);

  console.log('\n--- Query: Q2 All Categories (one quarter, all categories) ---\n');
  await showExplain(client, `
    SELECT * FROM sales_data
    WHERE sale_date >= '2024-04-01' AND sale_date < '2024-07-01'
  `);

  console.log('\n--- Query: All time, specific category (prunes by category only) ---\n');
  await showExplain(client, `
    SELECT * FROM sales_data
    WHERE category = 'clothing'
  `);
}

async function main() {
  const client = new Client(config.postgres);

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    console.log('\n');
    console.log('#'.repeat(80));
    console.log('#  PostgreSQL Partitioning Query Demonstration');
    console.log('#  Shows EXPLAIN ANALYZE output with partition pruning');
    console.log('#'.repeat(80));

    await demonstrateRangePartitioning(client);
    await demonstrateHashPartitioning(client);
    await demonstrateListPartitioning(client);
    await demonstrateCompositePartitioning(client);

    console.log('\n');
    console.log('='.repeat(80));
    console.log('DEMONSTRATION COMPLETE');
    console.log('='.repeat(80));
    console.log('\nKey takeaways:');
    console.log('- Range partitioning: Best for time-series data with date range queries');
    console.log('- Hash partitioning: Best for even distribution with point lookups');
    console.log('- List partitioning: Best for categorical data with known values');
    console.log('- Composite partitioning: Combines strategies for multi-dimensional queries');
    console.log('\nLook for "Partitions selected" in EXPLAIN output to verify pruning.\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Disconnected from PostgreSQL');
  }
}

main();
