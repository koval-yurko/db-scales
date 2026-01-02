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
      console.log('✓ WAL level is set to logical');
    } else {
      console.log(`⚠ WAL level is '${walLevel}' (will be configured to 'logical' by start-copy.js)`);
    }

    // Read and execute setup SQL
    const sqlPath = path.join(__dirname, 'scripts', '01_setup_tables.sql');
    console.log(`\nExecuting: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query(sql);

    console.log('\n✓ Database setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Run: node start-copy.js');
    if (walLevel !== 'logical') {
      console.log('2. If prompted, restart PostgreSQL: docker-compose restart');
      console.log('3. Run: node start-copy.js again to start full database replication');
    } else {
      console.log('2. The subscriber will perform initial table copy and then start replication');
    }
    console.log();
  } catch (error) {
    console.error('Error setting up database:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupData();
