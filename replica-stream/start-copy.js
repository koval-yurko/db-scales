const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');
const ReplicationSubscriber = require('./utils/subscriber');

async function checkReplicationConfig() {
  const client = new Client({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
  });

  try {
    await client.connect();

    // Check wal_level setting
    const result = await client.query('SHOW wal_level');
    const walLevel = result.rows[0].wal_level;

    await client.end();

    return walLevel === 'logical';
  } catch (error) {
    console.error('Error checking replication configuration:', error.message);
    process.exit(1);
  }
}

async function setupReplication() {
  const client = new Client({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
  });

  try {
    console.log('Setting up logical replication...\n');
    await client.connect();

    // Execute WAL configuration script
    console.log('Configuring PostgreSQL WAL settings...');
    const walSqlPath = path.join(__dirname, 'scripts', '02_configure_wal.sql');
    const walSql = fs.readFileSync(walSqlPath, 'utf8');

    // Execute statements separately to avoid transaction block issue with ALTER SYSTEM
    const statements = walSql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      if (stmt.toUpperCase().includes('ALTER SYSTEM')) {
        await client.query(stmt);
      }
    }

    console.log('✓ PostgreSQL WAL configuration updated');

    // Check current wal_level
    const walResult = await client.query('SHOW wal_level');
    console.log(`Current wal_level: ${walResult.rows[0].wal_level} (will be "logical" after restart)`);

    // Create checkpoint table now (doesn't require wal_level=logical)
    console.log('\nCreating checkpoint tracking table...');
    const checkpointSqlPath = path.join(__dirname, 'scripts', '00_create_checkpoint.sql');
    const checkpointSql = fs.readFileSync(checkpointSqlPath, 'utf8');
    await client.query(checkpointSql);
    console.log('✓ Checkpoint tracking table created');

    console.log('\n========================================');
    console.log('IMPORTANT: PostgreSQL needs to be restarted!');
    console.log('========================================');
    console.log('\nRun the following command to restart PostgreSQL:');
    console.log('  docker-compose restart\n');
    console.log('After restart, run this script again to:');
    console.log('  - Create publication for tables');
    console.log('  - Create replication slot');
    console.log('  - Start replication stream');
    console.log('========================================\n');

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('Error setting up replication:', error.message);
    await client.end();
    process.exit(1);
  }
}

async function createPublicationAndSlot() {
  const client = new Client({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
  });

  try {
    await client.connect();

    console.log('Setting up replication (publication and slot)...');

    // Create publication
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'my_pub') THEN
              CREATE PUBLICATION my_pub FOR TABLE users, orders, products;
              RAISE NOTICE 'Publication "my_pub" created';
          ELSE
              RAISE NOTICE 'Publication "my_pub" already exists';
          END IF;
      END $$;
    `);

    // Create replication slot (must be in separate transaction)
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'my_slot') THEN
              PERFORM pg_create_logical_replication_slot('my_slot', 'test_decoding');
              RAISE NOTICE 'Replication slot "my_slot" created';
          ELSE
              RAISE NOTICE 'Replication slot "my_slot" already exists';
          END IF;
      END $$;
    `);

    console.log('✓ Replication setup complete');

    await client.end();
    return true;
  } catch (error) {
    console.error('Error creating publication/slot:', error.message);
    await client.end();
    return false;
  }
}

async function startReplication() {
  console.log('PostgreSQL Logical Replication Subscriber');
  console.log('==========================================\n');

  // Check if replication is configured
  const isConfigured = await checkReplicationConfig();

  if (!isConfigured) {
    console.log('Logical replication not configured yet.');
    await setupReplication();
    return;
  }

  console.log('✓ Logical replication is configured (wal_level = logical)\n');

  // Create publication and slot if they don't exist
  console.log('Checking publication and replication slot...');
  const created = await createPublicationAndSlot();

  if (!created) {
    console.error('Failed to create publication or replication slot');
    process.exit(1);
  }

  console.log('\nStarting replication subscriber...\n');

  // Initialize and start subscriber
  const subscriber = new ReplicationSubscriber();

  try {
    await subscriber.initialize();
    await subscriber.startReplication();
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

startReplication();
