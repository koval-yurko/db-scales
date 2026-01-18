const { Client } = require('pg');
const config = require('./utils/config');
const { executeSqlFile } = require('./utils/sql-runner');
const { getPartitionStats } = require('./utils/partition-stats');

const scenarios = {
  add: {
    name: 'Add New Partition',
    description: 'Add a new January 2025 partition to event_logs',
    file: 'scripts/repartition/10_add_new_partition.sql',
    affectedTable: 'event_logs'
  },
  split: {
    name: 'Split Partition',
    description: 'Split February 2024 monthly partition into weekly partitions',
    file: 'scripts/repartition/11_split_partition.sql',
    affectedTable: 'event_logs'
  },
  detach: {
    name: 'Detach & Archive',
    description: 'Detach January 2024 partition and archive to separate table',
    file: 'scripts/repartition/12_detach_archive.sql',
    affectedTable: 'event_logs'
  },
  migrate: {
    name: 'Migrate Strategy',
    description: 'Create new RANGE partitioned users table from HASH partitioned one',
    file: 'scripts/repartition/13_migrate_strategy.sql',
    affectedTable: 'users_distributed'
  },
  cleanup: {
    name: 'Cleanup',
    description: 'Restore original partition state after running other scenarios',
    file: 'scripts/repartition/14_cleanup_repartition.sql',
    affectedTable: 'event_logs'
  }
};

function showHelp() {
  console.log('PostgreSQL Re-partitioning Scenarios');
  console.log('=====================================\n');
  console.log('Usage: node repartition.js <scenario>\n');
  console.log('Available scenarios:\n');

  for (const [key, scenario] of Object.entries(scenarios)) {
    console.log(`  ${key.padEnd(10)} - ${scenario.name}`);
    console.log(`             ${scenario.description}\n`);
  }

  console.log('Examples:');
  console.log('  node repartition.js add      # Add new partition');
  console.log('  node repartition.js split    # Split monthly to weekly');
  console.log('  node repartition.js detach   # Archive old partition');
  console.log('  node repartition.js migrate  # Change partitioning strategy');
  console.log('  node repartition.js cleanup  # Reset to original state\n');

  console.log('Recommended order for testing:');
  console.log('  1. add     - Extend partitions');
  console.log('  2. split   - Refine granularity');
  console.log('  3. detach  - Archive old data');
  console.log('  4. migrate - Change strategy');
  console.log('  5. cleanup - Reset everything\n');
}

async function runScenario(scenarioKey) {
  const scenario = scenarios[scenarioKey];

  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioKey}\n`);
    showHelp();
    process.exit(1);
  }

  const client = new Client(config.postgres);

  try {
    await client.connect();
    console.log('Connected to PostgreSQL\n');

    console.log('='.repeat(80));
    console.log(`SCENARIO: ${scenario.name}`);
    console.log(`${scenario.description}`);
    console.log('='.repeat(80));

    // Show before state
    console.log('\n--- BEFORE STATE ---');
    await getPartitionStats(client, scenario.affectedTable);

    // Execute the scenario SQL
    console.log('\n--- EXECUTING SCENARIO ---\n');
    const startTime = Date.now();

    const result = await executeSqlFile(client, scenario.file);

    const duration = Date.now() - startTime;

    if (!result.success) {
      console.error('\nScenario failed:', result.error.message);
      process.exit(1);
    }

    // Show after state
    console.log('\n--- AFTER STATE ---');
    await getPartitionStats(client, scenario.affectedTable);

    // If migrate scenario, also show the new table
    if (scenarioKey === 'migrate') {
      await getPartitionStats(client, 'users_by_date');
    }

    console.log('\n' + '='.repeat(80));
    console.log(`SCENARIO COMPLETE: ${scenario.name}`);
    console.log(`Execution time: ${duration}ms`);
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Disconnected from PostgreSQL');
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const scenarioKey = args[0].toLowerCase();
  await runScenario(scenarioKey);
}

main();
