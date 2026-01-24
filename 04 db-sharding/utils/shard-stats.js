const { getClient, runQuery } = require('./sql-runner');

async function isCitusEnabled(client) {
  try {
    const { result } = await runQuery(client, `
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    `);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

async function getDistributedTables(client) {
  const { result } = await runQuery(client, `
    SELECT
      logicalrelid::text AS table_name,
      partmethod AS distribution_method,
      colocationid AS colocation_id,
      (SELECT COUNT(*) FROM pg_dist_shard WHERE logicalrelid = t.logicalrelid) as shard_count
    FROM pg_dist_partition t
    ORDER BY table_name
  `);
  return result.rows;
}

async function getShardDistribution(client) {
  const { result } = await runQuery(client, `
    SELECT
      nodename,
      COUNT(*) as shard_count,
      pg_size_pretty(SUM(shard_size)) as total_size
    FROM citus_shards
    GROUP BY nodename
    ORDER BY nodename
  `);
  return result.rows;
}

async function getShardDetails(client, tableName = null) {
  const whereClause = tableName ? `WHERE table_name = '${tableName}'::regclass` : '';
  const { result } = await runQuery(client, `
    SELECT
      shardid,
      table_name::text,
      nodename,
      nodeport,
      pg_size_pretty(shard_size) as size
    FROM citus_shards
    ${whereClause}
    ORDER BY table_name, shardid
    LIMIT 50
  `);
  return result.rows;
}

async function getWorkerNodes(client) {
  const { result } = await runQuery(client, `
    SELECT * FROM citus_get_active_worker_nodes()
  `);
  return result.rows;
}

async function getClusterHealth(client) {
  try {
    const { result } = await runQuery(client, `
      SELECT * FROM citus_check_cluster_node_health()
    `);
    return result.rows;
  } catch (err) {
    return [{ error: err.message }];
  }
}

async function printShardStats(client) {
  const citusEnabled = await isCitusEnabled(client);

  console.log('\n' + '═'.repeat(60));
  console.log('SHARD STATISTICS');
  console.log('═'.repeat(60));

  if (!citusEnabled) {
    console.log('\nCitus is NOT enabled. Tables are regular PostgreSQL tables.');
    console.log('Run Phase 2 to enable Citus and distribute tables.\n');
    return;
  }

  console.log('\nCitus is ENABLED\n');

  // Worker nodes
  console.log('─'.repeat(40));
  console.log('Active Worker Nodes:');
  console.log('─'.repeat(40));
  const workers = await getWorkerNodes(client);
  if (workers.length > 0) {
    console.table(workers);
  } else {
    console.log('  No workers registered yet.\n');
  }

  // Distributed tables
  console.log('─'.repeat(40));
  console.log('Distributed Tables:');
  console.log('─'.repeat(40));
  const tables = await getDistributedTables(client);
  if (tables.length > 0) {
    console.table(tables);
  } else {
    console.log('  No distributed tables yet.\n');
  }

  // Shard distribution by worker
  if (workers.length > 0) {
    console.log('─'.repeat(40));
    console.log('Shards per Worker:');
    console.log('─'.repeat(40));
    const distribution = await getShardDistribution(client);
    console.table(distribution);

    // Sample shard details
    console.log('─'.repeat(40));
    console.log('Sample Shard Details (first 20):');
    console.log('─'.repeat(40));
    const shards = await getShardDetails(client);
    console.table(shards.slice(0, 20));
  }

  console.log('═'.repeat(60) + '\n');
}

module.exports = {
  isCitusEnabled,
  getDistributedTables,
  getShardDistribution,
  getShardDetails,
  getWorkerNodes,
  getClusterHealth,
  printShardStats,
};
