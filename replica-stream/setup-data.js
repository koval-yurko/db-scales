const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');

async function setupData() {
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

    // Check if wal_level is logical
    const walCheck = await client.query('SHOW wal_level');
    const walLevel = walCheck.rows[0].wal_level;

    if (walLevel === 'logical') {
      console.log('✓ WAL level is already set to logical');

      // Create replication slot BEFORE inserting data
      console.log('\nCreating replication slot before data insertion...');
      const slotCheck = await client.query(
        "SELECT 1 FROM pg_replication_slots WHERE slot_name = 'my_slot'"
      );

      if (slotCheck.rows.length === 0) {
        await client.query(
          "SELECT pg_create_logical_replication_slot('my_slot', 'test_decoding')"
        );
        console.log('✓ Replication slot created');
      } else {
        console.log('✓ Replication slot already exists');
      }

      // Create publication
      const pubCheck = await client.query(
        "SELECT 1 FROM pg_publication WHERE pubname = 'my_pub'"
      );

      if (pubCheck.rows.length === 0) {
        await client.query(
          "CREATE PUBLICATION my_pub FOR ALL TABLES"
        );
        console.log('✓ Publication created for all tables');
      } else {
        console.log('✓ Publication already exists');
      }
    } else {
      console.log(`⚠ WAL level is '${walLevel}' (needs to be 'logical')`);
      console.log('Replication slot will be created after WAL configuration\n');
    }

    // Read and execute setup SQL
    const sqlPath = path.join(__dirname, 'scripts', '01_setup_tables.sql');
    console.log(`\nExecuting: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query(sql);

    console.log('\n✓ Database setup completed successfully!');

    if (walLevel === 'logical') {
      console.log('\n✓ Replication slot was created BEFORE data insertion');
      console.log('✓ All inserted data will be captured in the replication stream\n');
      console.log('Next step:');
      console.log('  Run: node start-copy.js (to start replication subscriber)\n');
    } else {
      console.log('\nNext steps:');
      console.log('1. Run: node start-copy.js');
      console.log('2. If prompted, restart PostgreSQL: docker-compose restart');
      console.log('3. Run: node start-copy.js again to start replication\n');
    }
  } catch (error) {
    console.error('Error setting up database:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupData();
