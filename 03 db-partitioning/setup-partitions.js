const { Client } = require('pg');
const config = require('./utils/config');
const { executeSqlFiles } = require('./utils/sql-runner');

async function setupPartitions() {
  const client = new Client(config.postgres);

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('Connected successfully\n');

    // Check if base tables exist
    const tablesCheck = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('event_logs', 'users_distributed', 'orders_by_region', 'sales_data')
    `);

    if (tablesCheck.rows.length < 4) {
      console.error('✗ Base tables not found. Run "node setup-base.js" first.');
      process.exit(1);
    }

    // Check if already partitioned
    const partitionCheck = await client.query(`
      SELECT parent.relname
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      WHERE parent.relname IN ('event_logs', 'users_distributed', 'orders_by_region', 'sales_data')
      LIMIT 1
    `);

    if (partitionCheck.rows.length > 0) {
      console.error('✗ Tables are already partitioned. Run cleanup first if you want to re-partition.');
      process.exit(1);
    }

    // Show current state before partitioning
    console.log('========================================');
    console.log('BEFORE Partitioning - Current State');
    console.log('========================================\n');

    const tables = ['event_logs', 'users_distributed', 'orders_by_region', 'sales_data'];
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`${table.padEnd(25)} ${result.rows[0].count} rows (single table)`);
    }

    // Execute partitioning scripts
    const sqlFiles = [
      'scripts/01_range_partitions.sql',
      'scripts/02_hash_partitions.sql',
      'scripts/03_list_partitions.sql',
      'scripts/04_composite_partitions.sql'
    ];

    console.log('\n========================================');
    console.log('Applying Partitioning Migration');
    console.log('========================================\n');

    const results = await executeSqlFiles(client, sqlFiles);

    const allSuccessful = results.every(r => r.success);

    if (!allSuccessful) {
      console.error('\n✗ Partitioning failed. Please check the errors above.');
      process.exit(1);
    }

    // Show state after partitioning
    console.log('\n========================================');
    console.log('AFTER Partitioning - New State');
    console.log('========================================\n');

    // Show row counts for all tables (including _old)
    const allTables = [
      { name: 'event_logs', old: 'event_logs_old' },
      { name: 'users_distributed', old: 'users_distributed_old' },
      { name: 'orders_by_region', old: 'orders_by_region_old' },
      { name: 'sales_data', old: 'sales_data_old' }
    ];

    for (const { name, old } of allTables) {
      const newResult = await client.query(`SELECT COUNT(*) FROM ${name}`);
      const oldResult = await client.query(`SELECT COUNT(*) FROM ${old}`);
      console.log(`${name.padEnd(25)} ${newResult.rows[0].count} rows (partitioned)`);
      console.log(`${old.padEnd(25)} ${oldResult.rows[0].count} rows (original backup)`);
      console.log();
    }

    // Show partition counts
    console.log('========================================');
    console.log('Partition Summary');
    console.log('========================================\n');

    const partitionInfo = [
      { table: 'event_logs', type: 'RANGE (by created_at)', pattern: 'event_logs_2024%' },
      { table: 'users_distributed', type: 'HASH (by id)', pattern: 'users_distributed_p%' },
      { table: 'orders_by_region', type: 'LIST (by region)', pattern: 'orders_%' },
      { table: 'sales_data', type: 'COMPOSITE (RANGE+LIST)', pattern: 'sales_data_2024%' }
    ];

    for (const { table, type, pattern } of partitionInfo) {
      const result = await client.query(
        `SELECT COUNT(*) FROM pg_tables WHERE tablename LIKE $1 AND schemaname = 'public'`,
        [pattern]
      );
      console.log(`${table}`);
      console.log(`  Type: ${type}`);
      console.log(`  Partitions: ${result.rows[0].count}`);
      console.log();
    }

    console.log('✓ Partitioning migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Load more data:  node load-data.js [interval_ms] [duration_sec]');
    console.log('2. Demo queries:    node demonstrate-queries.js');
    console.log('3. Re-partition:    node repartition.js <scenario>');
    console.log();

  } catch (error) {
    console.error('Error during partitioning:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupPartitions();
