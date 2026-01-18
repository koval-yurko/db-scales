const { Client } = require('pg');
const config = require('./utils/config');
const { executeSqlFiles } = require('./utils/sql-runner');

async function setupDatabase() {
  const client = new Client({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
  });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('Connected successfully\n');

    // Execute SQL files in order
    const sqlFiles = [
      'scripts/00_setup_base_tables.sql',
      'scripts/00_initial_seed_data.sql',
      'scripts/01_range_partitions.sql',
      'scripts/02_hash_partitions.sql',
      'scripts/03_list_partitions.sql',
      'scripts/04_composite_partitions.sql'
    ];

    console.log('========================================');
    console.log('PostgreSQL Partitioning Setup');
    console.log('========================================\n');

    const results = await executeSqlFiles(client, sqlFiles);

    const allSuccessful = results.every(r => r.success);

    if (!allSuccessful) {
      console.error('\n✗ Setup failed. Please check the errors above.');
      process.exit(1);
    }

    // Display summary statistics
    console.log('\n========================================');
    console.log('Setup Complete - Table Summary');
    console.log('========================================\n');

    // Show row counts for all tables
    const tables = [
      'event_logs',
      'event_logs_old',
      'users_distributed',
      'users_distributed_old',
      'orders_by_region',
      'orders_by_region_old',
      'sales_data',
      'sales_data_old'
    ];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        const status = table.endsWith('_old') ? '(original)' : '(partitioned)';
        console.log(`${table.padEnd(30)} ${status.padEnd(15)} ${result.rows[0].count} rows`);
      } catch (error) {
        console.log(`${table.padEnd(30)} - not found or error`);
      }
    }

    console.log('\n========================================');
    console.log('Partition Counts');
    console.log('========================================\n');

    // Count partitions for each table
    const partitionQueries = [
      { table: 'event_logs', pattern: 'event_logs_2024%' },
      { table: 'users_distributed', pattern: 'users_distributed_p%' },
      { table: 'orders_by_region', pattern: 'orders_%' },
      { table: 'sales_data', pattern: 'sales_2024%' }
    ];

    for (const { table, pattern } of partitionQueries) {
      const result = await client.query(
        `SELECT COUNT(*) FROM pg_tables WHERE tablename LIKE $1 AND schemaname = 'public'`,
        [pattern]
      );
      console.log(`${table.padEnd(30)} ${result.rows[0].count} partitions`);
    }

    console.log('\n✓ Database setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Run: node load-data.js [interval_ms] [duration_sec]');
    console.log('2. Run: node demonstrate-queries.js');
    console.log('3. Run: node repartition.js <scenario>');
    console.log();

  } catch (error) {
    console.error('Error setting up database:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDatabase();
