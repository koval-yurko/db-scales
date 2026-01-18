const { Client } = require('pg');
const config = require('./utils/config');
const { executeSqlFiles } = require('./utils/sql-runner');

async function setupBaseTables() {
  const client = new Client(config.postgres);

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('Connected successfully\n');

    // Execute only base table setup and seed data
    const sqlFiles = [
      'scripts/00_setup_base_tables.sql',
      'scripts/00_initial_seed_data.sql'
    ];

    console.log('========================================');
    console.log('PostgreSQL Base Tables Setup');
    console.log('(No Partitioning - Single Tables)');
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

    const tables = [
      'event_logs',
      'users_distributed',
      'orders_by_region',
      'sales_data'
    ];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`${table.padEnd(25)} ${result.rows[0].count} rows`);
      } catch (error) {
        console.log(`${table.padEnd(25)} - error: ${error.message}`);
      }
    }

    // Show table type (non-partitioned)
    console.log('\n========================================');
    console.log('Table Status');
    console.log('========================================\n');

    for (const table of tables) {
      const partitionCheck = await client.query(`
        SELECT COUNT(*) as partition_count
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        WHERE parent.relname = $1
      `, [table]);

      const isPartitioned = parseInt(partitionCheck.rows[0].partition_count) > 0;
      console.log(`${table.padEnd(25)} ${isPartitioned ? 'PARTITIONED' : 'SINGLE TABLE'}`);
    }

    console.log('\n✓ Base tables setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Load data:        node load-data.js [interval_ms] [duration_sec]');
    console.log('2. Demo queries:     node demonstrate-queries.js');
    console.log('3. Apply partitions: node setup-partitions.js');
    console.log();

  } catch (error) {
    console.error('Error setting up database:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupBaseTables();
