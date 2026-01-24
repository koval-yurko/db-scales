#!/usr/bin/env node
/**
 * Resharding Orchestrator
 * Manages all sharding and resharding operations
 *
 * Usage: node reshard.js <scenario>
 *
 * Scenarios:
 *   enable-citus   - Phase 2: Enable Citus, add workers, distribute tables
 *   add-worker     - Phase 3: Add worker3 to the cluster
 *   rebalance      - Phase 3: Rebalance shards across all workers
 *   isolate        - Phase 3: Isolate hot tenant to dedicated shard
 *   drain          - Phase 3: Drain and remove a worker
 *   undistribute   - Phase 4: Convert back to regular PostgreSQL tables
 */

const { getClient, runSqlFile, runQuery } = require('./utils/sql-runner');
const { isCitusEnabled, printShardStats, getWorkerNodes } = require('./utils/shard-stats');

const SCENARIO = process.argv[2];

async function enableCitus(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 2: Enable Citus and Distribute Tables');
  console.log('═'.repeat(60));

  // Check if already enabled
  if (await isCitusEnabled(client)) {
    console.log('\nCitus is already enabled. Checking distribution...');
    await printShardStats(client);
    return;
  }

  // Step 1: Enable Citus extension
  console.log('\nStep 1: Enabling Citus extension...');
  await runSqlFile(client, 'scripts/sharding/10_enable_citus.sql');

  // Step 2: Add worker nodes
  console.log('\nStep 2: Adding worker nodes...');
  await runSqlFile(client, 'scripts/sharding/11_add_workers.sql');

  // Step 3: Create reference table
  console.log('\nStep 3: Creating reference table (regions)...');
  await runSqlFile(client, 'scripts/sharding/13_create_reference_table.sql');

  // Step 4: Distribute main tables
  console.log('\nStep 4: Distributing tables...');
  await runSqlFile(client, 'scripts/sharding/12_distribute_table.sql');

  // Step 5: Verify distribution
  console.log('\nStep 5: Verifying distribution...');
  await runSqlFile(client, 'scripts/sharding/14_verify_distribution.sql');

  await printShardStats(client);

  console.log('\n✓ Phase 2 Complete: Tables are now distributed across workers');
  console.log('  Run "npm run demo" to see distributed query execution.\n');
}

async function addWorker(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 3: Add Worker Node');
  console.log('═'.repeat(60));

  if (!(await isCitusEnabled(client))) {
    console.error('\nError: Citus is not enabled. Run "npm run enable-citus" first.\n');
    process.exit(1);
  }

  // Check if worker3 is already added
  const workers = await getWorkerNodes(client);
  if (workers.some(w => w.node_name === 'worker3')) {
    console.log('\nworker3 is already registered in the cluster.');
    await printShardStats(client);
    return;
  }

  await runSqlFile(client, 'scripts/resharding/30_add_worker_node.sql');
  await printShardStats(client);

  console.log('\n✓ Worker3 added to cluster');
  console.log('  Run "npm run rebalance" to distribute shards to the new worker.\n');
}

async function rebalanceShards(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 3: Rebalance Shards');
  console.log('═'.repeat(60));

  if (!(await isCitusEnabled(client))) {
    console.error('\nError: Citus is not enabled. Run "npm run enable-citus" first.\n');
    process.exit(1);
  }

  await runSqlFile(client, 'scripts/resharding/31_rebalance_shards.sql');
  await printShardStats(client);

  console.log('\n✓ Shards rebalanced across all workers\n');
}

async function isolateTenant(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 3: Isolate Hot Tenant');
  console.log('═'.repeat(60));

  if (!(await isCitusEnabled(client))) {
    console.error('\nError: Citus is not enabled. Run "npm run enable-citus" first.\n');
    process.exit(1);
  }

  await runSqlFile(client, 'scripts/resharding/32_isolate_tenant.sql');
  await printShardStats(client);

  console.log('\n✓ Hot tenant isolated to dedicated shard\n');
}

async function drainWorker(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 3: Drain Worker Node');
  console.log('═'.repeat(60));

  if (!(await isCitusEnabled(client))) {
    console.error('\nError: Citus is not enabled. Run "npm run enable-citus" first.\n');
    process.exit(1);
  }

  console.log('\nThis will move all shards off worker2 and remove it from the cluster.');
  console.log('The container will keep running but will not be part of the cluster.\n');

  await runSqlFile(client, 'scripts/resharding/33_drain_worker.sql');
  await printShardStats(client);

  console.log('\n✓ Worker2 drained and removed from cluster\n');
}

async function undistribute(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 4: Undistribute Tables');
  console.log('═'.repeat(60));

  if (!(await isCitusEnabled(client))) {
    console.log('\nCitus is not enabled. Tables are already regular PostgreSQL tables.\n');
    return;
  }

  console.log('\nThis will consolidate all data back to the coordinator.');
  console.log('Tables will become regular PostgreSQL tables.\n');

  await runSqlFile(client, 'scripts/resharding/34_undistribute_table.sql');

  // Verify
  console.log('\nVerifying tables are undistributed...');
  const { result } = await runQuery(client, `
    SELECT logicalrelid::text FROM pg_dist_partition
  `);

  if (result.rows.length === 0) {
    console.log('✓ All tables are now regular PostgreSQL tables.');
  } else {
    console.log('Remaining distributed tables:');
    console.table(result.rows);
  }

  // Show row counts
  const { result: counts } = await runQuery(client, `
    SELECT 'orders' as table_name, COUNT(*) as rows FROM orders
    UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
    UNION ALL SELECT 'regions', COUNT(*) FROM regions
    UNION ALL SELECT 'users', COUNT(*) FROM users
  `);
  console.log('\nTable row counts (data preserved):');
  console.table(counts.rows);

  console.log('\n✓ Phase 4 Complete: All tables are now regular PostgreSQL tables');
  console.log('  Workers can be stopped if no longer needed.\n');
}

function printUsage() {
  console.log(`
Usage: node reshard.js <scenario>

Scenarios:
  enable-citus   Phase 2: Enable Citus, add workers, distribute tables
  add-worker     Phase 3: Add worker3 to the cluster
  rebalance      Phase 3: Rebalance shards across all workers
  isolate        Phase 3: Isolate hot tenant to dedicated shard
  drain          Phase 3: Drain and remove worker2
  undistribute   Phase 4: Convert back to regular PostgreSQL tables

Examples:
  node reshard.js enable-citus
  node reshard.js add-worker
  node reshard.js rebalance
`);
}

async function main() {
  if (!SCENARIO) {
    printUsage();
    process.exit(1);
  }

  const client = await getClient();

  try {
    switch (SCENARIO) {
      case 'enable-citus':
        await enableCitus(client);
        break;
      case 'add-worker':
        await addWorker(client);
        break;
      case 'rebalance':
        await rebalanceShards(client);
        break;
      case 'isolate':
        await isolateTenant(client);
        break;
      case 'drain':
        await drainWorker(client);
        break;
      case 'undistribute':
        await undistribute(client);
        break;
      default:
        console.error(`Unknown scenario: ${SCENARIO}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
