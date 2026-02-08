const { runSQL, query, closePool } = require('./utils/sql-runner');
const { generateAccounts, generateEvents } = require('./utils/data-generator');
const { printEventStoreStats } = require('./utils/event-store-stats');
const { config } = require('./utils/config');

const BATCH_SIZE = 1000;

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('PHASE 1: EVENT STORE SETUP');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Create tables
  console.log('Step 1: Creating event store tables...');
  await runSQL('scripts/setup/00_create_event_store.sql', 'Create event store');

  // Step 2: Seed accounts
  console.log('\nStep 2: Seeding accounts...');
  const accounts = generateAccounts();
  const accountValues = accounts.map(a =>
    `(${a.id}, '${a.account_number}', '${a.holder_name.replace(/'/g, "''")}', '${a.account_type}', '${a.currency}')`
  ).join(',\n    ');

  await query(`
    INSERT INTO accounts (id, account_number, holder_name, account_type, currency)
    VALUES ${accountValues}
  `);
  // Reset sequence to next value
  await query(`SELECT setval('accounts_id_seq', ${accounts.length})`);
  console.log(`  Inserted ${accounts.length} accounts (${config.seed.checking} checking, ${config.seed.savings} savings, ${config.seed.business} business)`);

  // Step 3: Generate events
  console.log(`\nStep 3: Generating ${config.seed.events.toLocaleString()} events...`);
  const genStart = Date.now();
  const events = generateEvents(accounts, config.seed.events);
  const genDuration = Date.now() - genStart;
  console.log(`  Generated ${events.length.toLocaleString()} events in ${genDuration}ms`);

  // Step 4: Batch insert events
  console.log(`\nStep 4: Inserting events (batch size: ${BATCH_SIZE})...`);
  const insertStart = Date.now();
  let inserted = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const values = batch.map(e =>
      `(${e.account_id}, '${e.event_type}', ${e.amount}, ${e.balance_after}, '${e.metadata.replace(/'/g, "''")}', ${e.sequence_number}, '${e.created_at.toISOString()}')`
    ).join(',\n    ');

    await query(`
      INSERT INTO account_events (account_id, event_type, amount, balance_after, metadata, sequence_number, created_at)
      VALUES ${values}
    `);

    inserted += batch.length;
    if (inserted % 50000 === 0 || inserted === events.length) {
      const elapsed = ((Date.now() - insertStart) / 1000).toFixed(1);
      const rate = Math.round(inserted / (Date.now() - insertStart) * 1000);
      console.log(`  Inserted ${inserted.toLocaleString()} / ${events.length.toLocaleString()} events (${elapsed}s, ${rate.toLocaleString()} events/sec)`);
    }
  }

  const insertDuration = ((Date.now() - insertStart) / 1000).toFixed(1);
  console.log(`\n  Total insert time: ${insertDuration}s`);
  console.log(`  Average throughput: ${Math.round(events.length / (Date.now() - insertStart) * 1000).toLocaleString()} events/sec`);

  // Step 5: Print stats
  await printEventStoreStats();

  // Step 6: Run sample direct queries
  console.log('═══════════════════════════════════════════════════════');
  console.log('DIRECT EVENT STORE QUERIES (baseline - no projections)');
  console.log('═══════════════════════════════════════════════════════\n');

  // Single account balance
  let start = Date.now();
  const singleBalance = await query(`
    SELECT balance_after
    FROM account_events
    WHERE account_id = 1
    ORDER BY sequence_number DESC
    LIMIT 1
  `);
  console.log(`  Single account balance:  ${singleBalance.rows[0]?.balance_after || 'N/A'}  (${Date.now() - start}ms)`);

  // All account balances
  start = Date.now();
  const allBalances = await query(`
    SELECT DISTINCT ON (account_id)
      account_id, balance_after AS current_balance
    FROM account_events
    ORDER BY account_id, sequence_number DESC
  `);
  console.log(`  All account balances:    ${allBalances.rowCount} accounts  (${Date.now() - start}ms)`);

  // Monthly summary for account 1
  start = Date.now();
  const monthly = await query(`
    SELECT
      DATE_TRUNC('month', created_at) AS month,
      COUNT(*) AS tx_count,
      SUM(CASE WHEN event_type IN ('money_deposited','transfer_received','interest_applied')
          THEN amount ELSE 0 END) AS total_credits,
      SUM(CASE WHEN event_type IN ('money_withdrawn','transfer_sent','fee_charged')
          THEN amount ELSE 0 END) AS total_debits
    FROM account_events
    WHERE account_id = 1
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month
  `);
  console.log(`  Monthly summary (acct 1): ${monthly.rowCount} months  (${Date.now() - start}ms)`);

  console.log('\n  Phase 1 complete. Next: npm run phase2 (build projections)\n');

  await closePool();
}

main().catch(err => {
  console.error('Setup failed:', err);
  closePool().then(() => process.exit(1));
});
