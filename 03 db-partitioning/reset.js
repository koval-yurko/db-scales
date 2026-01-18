const { Client } = require('pg');
const config = require('./utils/config');

async function resetToSingleTables() {
  const client = new Client(config.postgres);

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('Connected successfully\n');

    console.log('========================================');
    console.log('Reset: Reverting to Single Tables');
    console.log('========================================\n');

    const tables = [
      { name: 'event_logs', old: 'event_logs_old' },
      { name: 'users_distributed', old: 'users_distributed_old' },
      { name: 'orders_by_region', old: 'orders_by_region_old' },
      { name: 'sales_data', old: 'sales_data_old' }
    ];

    for (const { name, old } of tables) {
      console.log(`\nProcessing ${name}...`);

      // Check if _old table exists (meaning we have partitioned version)
      const oldExists = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_tables
          WHERE schemaname = 'public' AND tablename = $1
        )
      `, [old]);

      if (!oldExists.rows[0].exists) {
        console.log(`  ⚠ ${old} not found - skipping (table may already be single)`);
        continue;
      }

      // Check if current table is partitioned
      const isPartitioned = await client.query(`
        SELECT COUNT(*) as cnt FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        WHERE parent.relname = $1
      `, [name]);

      if (parseInt(isPartitioned.rows[0].cnt) === 0) {
        console.log(`  ⚠ ${name} is not partitioned - skipping`);
        continue;
      }

      // Get row counts before
      const partitionedCount = await client.query(`SELECT COUNT(*) FROM "${name}"`);
      const oldCount = await client.query(`SELECT COUNT(*) FROM "${old}"`);
      console.log(`  Partitioned: ${partitionedCount.rows[0].count} rows`);
      console.log(`  Original (_old): ${oldCount.rows[0].count} rows`);

      // Drop partitioned table (CASCADE drops all partitions)
      await client.query(`DROP TABLE "${name}" CASCADE`);
      console.log(`  ✓ Dropped partitioned table ${name}`);

      // Rename _old back to original name
      await client.query(`ALTER TABLE "${old}" RENAME TO "${name}"`);
      console.log(`  ✓ Renamed ${old} → ${name}`);

      // Verify
      const finalCount = await client.query(`SELECT COUNT(*) FROM "${name}"`);
      console.log(`  ✓ Restored: ${finalCount.rows[0].count} rows (single table)`);
    }

    // Show final state
    console.log('\n========================================');
    console.log('Reset Complete - Table Status');
    console.log('========================================\n');

    for (const { name } of tables) {
      try {
        const partitionCheck = await client.query(`
          SELECT COUNT(*) as cnt FROM pg_inherits
          JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
          WHERE parent.relname = $1
        `, [name]);

        const rowCount = await client.query(`SELECT COUNT(*) FROM "${name}"`);
        const isPartitioned = parseInt(partitionCheck.rows[0].cnt) > 0;

        console.log(`${name.padEnd(25)} ${isPartitioned ? 'PARTITIONED' : 'SINGLE TABLE'} (${rowCount.rows[0].count} rows)`);
      } catch (err) {
        console.log(`${name.padEnd(25)} ERROR: ${err.message}`);
      }
    }

    console.log('\n✓ Reset completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Load more data: node load-data.js [interval_ms] [duration_sec]');
    console.log('2. Run demo:       node demonstrate-queries.js');
    console.log('3. Re-partition:   node setup-partitions.js');
    console.log();

  } catch (error) {
    console.error('Error during reset:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetToSingleTables();
