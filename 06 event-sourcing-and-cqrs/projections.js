const { runSQL, query, timedQuery, closePool } = require('./utils/sql-runner');
const { printEventStoreStats } = require('./utils/event-store-stats');

const commands = {
  async build() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('PHASE 2: BUILD PROJECTIONS FROM EVENT REPLAY');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('Step 1: Creating projection tables...');
    await runSQL('scripts/projections/10_create_projection_tables.sql', 'Create projection tables');

    console.log('\nStep 2: Replaying events into projections...');
    const totalStart = Date.now();

    const r1 = await runSQL('scripts/projections/11_build_balances.sql', 'Build account balances');
    const r2 = await runSQL('scripts/projections/12_build_history.sql', 'Build transaction history');
    const r3 = await runSQL('scripts/projections/13_build_statements.sql', 'Build monthly statements');

    const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
    console.log(`\n  Total replay time: ${totalDuration}s`);

    // Verify projection counts
    console.log('\nStep 3: Verifying projections...');
    const balCount = await query('SELECT COUNT(*) AS cnt FROM proj_account_balances');
    const histCount = await query('SELECT COUNT(*) AS cnt FROM proj_transaction_history');
    const stmtCount = await query('SELECT COUNT(*) AS cnt FROM proj_monthly_statements');
    console.log(`  proj_account_balances:    ${parseInt(balCount.rows[0].cnt).toLocaleString()} rows`);
    console.log(`  proj_transaction_history: ${parseInt(histCount.rows[0].cnt).toLocaleString()} rows`);
    console.log(`  proj_monthly_statements:  ${parseInt(stmtCount.rows[0].cnt).toLocaleString()} rows`);

    // Accuracy check: compare projection balance vs event store balance for a sample
    console.log('\nStep 4: Accuracy check (sample of 5 accounts)...');
    const accuracy = await query(`
      SELECT
        p.account_id,
        p.current_balance AS projection_balance,
        (SELECT balance_after FROM account_events ae
         WHERE ae.account_id = p.account_id
         ORDER BY sequence_number DESC LIMIT 1) AS event_store_balance,
        p.current_balance = (SELECT balance_after FROM account_events ae
         WHERE ae.account_id = p.account_id
         ORDER BY sequence_number DESC LIMIT 1) AS matches
      FROM proj_account_balances p
      ORDER BY p.account_id
      LIMIT 5
    `);
    for (const row of accuracy.rows) {
      const status = row.matches ? 'OK' : 'MISMATCH';
      console.log(`  Account ${String(row.account_id).padStart(4)}: projection=${row.projection_balance} event_store=${row.event_store_balance} [${status}]`);
    }

    await printEventStoreStats();
    console.log('  Phase 2 complete. Next: npm run phase3 (live triggers)\n');
  },

  async 'live-sync'() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('PHASE 3: LIVE PROJECTION TRIGGERS');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('Step 1: Creating trigger functions...');
    await runSQL('scripts/live-sync/20_projection_triggers.sql', 'Create trigger functions');

    console.log('\nStep 2: Attaching triggers to account_events...');
    await runSQL('scripts/live-sync/21_attach_triggers.sql', 'Attach triggers');

    // Verify triggers
    console.log('\nStep 3: Verifying triggers...');
    const triggers = await query(`
      SELECT t.tgname AS trigger_name, p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_proc p ON t.tgfoid = p.oid
      WHERE t.tgrelid = 'account_events'::regclass AND NOT t.tgisinternal
      ORDER BY t.tgname
    `);
    for (const t of triggers.rows) {
      console.log(`  ${t.trigger_name} → ${t.function_name}`);
    }

    // Test live update: insert an event and verify projection updates
    console.log('\nStep 4: Testing live projection update...');
    const seqResult = await query(`
      SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq,
             (SELECT balance_after FROM account_events WHERE account_id = 1
              ORDER BY sequence_number DESC LIMIT 1) AS current_balance
      FROM account_events WHERE account_id = 1
    `);
    const nextSeq = parseInt(seqResult.rows[0].next_seq);
    const currentBalance = parseFloat(seqResult.rows[0].current_balance);
    const testAmount = 100.00;
    const newBalance = Math.round((currentBalance + testAmount) * 100) / 100;

    // Insert test event
    const insertStart = Date.now();
    await query(`
      INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
      VALUES (1, 'money_deposited', ${testAmount}, ${newBalance}, ${nextSeq},
              '{"description": "Test deposit - live trigger verification"}')
    `);
    const insertTime = Date.now() - insertStart;

    // Check projection immediately
    const projResult = await query(`
      SELECT current_balance, transaction_count FROM proj_account_balances WHERE account_id = 1
    `);
    console.log(`  Inserted test event: +$${testAmount} → balance $${newBalance} (${insertTime}ms with triggers)`);
    console.log(`  Projection balance:  $${projResult.rows[0].current_balance} (tx count: ${projResult.rows[0].transaction_count})`);
    console.log(`  Live sync: ${parseFloat(projResult.rows[0].current_balance) === newBalance ? 'VERIFIED' : 'MISMATCH'}`);

    // Measure write overhead
    console.log('\nStep 5: Measuring write overhead (10 events with triggers)...');
    let totalTriggerTime = 0;
    for (let i = 0; i < 10; i++) {
      const seq = nextSeq + 1 + i;
      const bal = Math.round((newBalance + (i + 1) * 50) * 100) / 100;
      const start = Date.now();
      await query(`
        INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
        VALUES (1, 'money_deposited', 50, ${bal}, ${seq},
                '{"description": "Overhead test ${i + 1}"}')
      `);
      totalTriggerTime += Date.now() - start;
    }
    console.log(`  Average write latency with triggers: ${(totalTriggerTime / 10).toFixed(1)}ms per event`);

    await printEventStoreStats();
    console.log('  Phase 3 complete. Next: npm run phase4 (snapshots)\n');
  },

  async snapshots() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('PHASE 4: SNAPSHOTS');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('Step 1: Creating snapshot table...');
    await runSQL('scripts/snapshots/30_create_snapshot_table.sql', 'Create snapshot table');

    console.log('\nStep 2: Taking snapshots for all accounts...');
    const snapStart = Date.now();
    await runSQL('scripts/snapshots/31_take_snapshots.sql', 'Take snapshots');
    const snapDuration = Date.now() - snapStart;

    const snapCount = await query('SELECT COUNT(*) AS cnt FROM account_snapshots');
    const snapSize = await query("SELECT pg_size_pretty(pg_total_relation_size('account_snapshots')) AS size");
    console.log(`  Snapshots taken: ${snapCount.rows[0].cnt} accounts in ${snapDuration}ms`);
    console.log(`  Snapshot storage: ${snapSize.rows[0].size}`);

    // Benchmark: full replay vs snapshot rebuild for a single account
    console.log('\nStep 3: Rebuild benchmark (account 1)...');

    // Full replay
    const fullStart = Date.now();
    await query(`
      SELECT
        SUM(CASE WHEN event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
            THEN amount ELSE 0 END) AS total_deposits,
        SUM(CASE WHEN event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN amount ELSE 0 END) AS total_withdrawals,
        COUNT(*) AS tx_count
      FROM account_events WHERE account_id = 1
    `);
    const fullDuration = Date.now() - fullStart;

    // Snapshot + delta
    const snapRebuildStart = Date.now();
    await query(`
      WITH snap AS (
        SELECT snapshot_sequence, balance, total_deposits, total_withdrawals, transaction_count
        FROM account_snapshots WHERE account_id = 1
        ORDER BY snapshot_sequence DESC LIMIT 1
      )
      SELECT
        s.balance + COALESCE(SUM(CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied')
            THEN ae.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN ae.amount ELSE 0 END), 0) AS rebuilt_balance,
        s.transaction_count + COUNT(ae.id) AS rebuilt_tx_count
      FROM snap s
      LEFT JOIN account_events ae ON ae.account_id = 1 AND ae.sequence_number > s.snapshot_sequence
      GROUP BY s.balance, s.transaction_count
    `);
    const snapRebuildDuration = Date.now() - snapRebuildStart;

    console.log(`  Full replay (all events):     ${fullDuration}ms`);
    console.log(`  Snapshot + delta:             ${snapRebuildDuration}ms`);
    if (snapRebuildDuration > 0) {
      console.log(`  Speedup:                      ${(fullDuration / snapRebuildDuration).toFixed(1)}x`);
    }

    // Full projection rebuild benchmark
    console.log('\nStep 4: Full projection rebuild benchmark (all accounts)...');
    const fullRebuildStart = Date.now();
    await query(`
      SELECT DISTINCT ON (account_id)
        account_id, balance_after AS current_balance
      FROM account_events
      ORDER BY account_id, sequence_number DESC
    `);
    const fullRebuildDuration = Date.now() - fullRebuildStart;
    console.log(`  Full all-account replay: ${fullRebuildDuration}ms`);

    await printEventStoreStats();
    console.log('  Phase 4 complete. Next: npm run phase5 (temporal + rebuild)\n');
  },

  async rebuild() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('PHASE 5: TEMPORAL QUERIES & FULL REBUILD');
    console.log('═══════════════════════════════════════════════════════\n');

    // Temporal queries
    await commands.temporal();

    // Full projection rebuild
    console.log('\nStep 2: Full projection rebuild...');
    console.log('  Truncating projections...');
    await query('TRUNCATE proj_account_balances CASCADE');
    await query('TRUNCATE proj_transaction_history CASCADE');
    await query('TRUNCATE proj_monthly_statements CASCADE');

    console.log('  Rebuilding from events...');
    const rebuildStart = Date.now();
    await runSQL('scripts/projections/11_build_balances.sql', 'Rebuild balances');
    await runSQL('scripts/projections/12_build_history.sql', 'Rebuild history');
    await runSQL('scripts/projections/13_build_statements.sql', 'Rebuild statements');
    const rebuildDuration = ((Date.now() - rebuildStart) / 1000).toFixed(1);
    console.log(`\n  Full rebuild completed in ${rebuildDuration}s`);

    // Integrity check
    console.log('\nStep 3: Integrity check (rebuilt projections vs event store)...');
    const integrity = await query(`
      SELECT COUNT(*) AS mismatches
      FROM proj_account_balances p
      WHERE p.current_balance != (
        SELECT balance_after FROM account_events ae
        WHERE ae.account_id = p.account_id
        ORDER BY sequence_number DESC LIMIT 1
      )
    `);
    const mismatches = parseInt(integrity.rows[0].mismatches);
    console.log(`  Balance mismatches: ${mismatches} ${mismatches === 0 ? '(PERFECT)' : '(ERRORS FOUND)'}`);

    await printEventStoreStats();
    console.log('  Phase 5 complete. All phases done!\n');
  },

  async temporal() {
    console.log('Step 1: Temporal queries...\n');

    // Single account balance 6 months ago
    const { result: r1, duration: d1 } = await timedQuery(`
      SELECT balance_after AS balance_at_date
      FROM account_events
      WHERE account_id = 1
        AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
      ORDER BY sequence_number DESC
      LIMIT 1
    `, [], 'Balance 6 months ago');
    console.log(`  Account 1 balance 6 months ago: $${r1.rows[0]?.balance_at_date || 'N/A'}  (${d1}ms)`);

    // All accounts 6 months ago
    const { result: r2, duration: d2 } = await timedQuery(`
      SELECT DISTINCT ON (account_id)
        account_id, balance_after AS balance_at_date
      FROM account_events
      WHERE created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
      ORDER BY account_id, sequence_number DESC
    `, [], 'All balances 6 months ago');
    console.log(`  All account balances 6 months ago: ${r2.rowCount} accounts  (${d2}ms)`);

    // End of month balances for account 1
    const { result: r3, duration: d3 } = await timedQuery(`
      SELECT DISTINCT ON (DATE_TRUNC('month', created_at))
        DATE_TRUNC('month', created_at)::DATE AS month,
        balance_after AS end_of_month_balance
      FROM account_events
      WHERE account_id = 1
      ORDER BY DATE_TRUNC('month', created_at), sequence_number DESC
    `, [], 'Monthly balance timeline');
    console.log(`  Account 1 monthly balances: ${r3.rowCount} months  (${d3}ms)`);
    for (const row of r3.rows) {
      console.log(`    ${row.month}  $${parseFloat(row.end_of_month_balance).toLocaleString()}`);
    }

    // Snapshot-optimized temporal query
    try {
      const { result: r4, duration: d4 } = await timedQuery(`
        WITH snapshot AS (
          SELECT account_id, snapshot_sequence, balance
          FROM account_snapshots
          WHERE account_id = 1
            AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '3 months')
          ORDER BY snapshot_sequence DESC LIMIT 1
        ),
        delta AS (
          SELECT balance_after
          FROM account_events
          WHERE account_id = 1
            AND sequence_number > COALESCE((SELECT snapshot_sequence FROM snapshot), 0)
            AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '3 months')
          ORDER BY sequence_number DESC
          LIMIT 1
        )
        SELECT COALESCE(
          (SELECT balance_after FROM delta),
          (SELECT balance FROM snapshot)
        ) AS balance_at_date
      `, [], 'Snapshot-optimized temporal');
      console.log(`\n  Snapshot-optimized balance 3mo ago: $${r4.rows[0]?.balance_at_date || 'N/A'}  (${d4}ms)`);
    } catch {
      console.log('\n  Snapshot-optimized query: snapshots not available yet');
    }
  },
};

async function main() {
  const command = process.argv[2];
  if (!command || !commands[command]) {
    console.log('Usage: node projections.js <command>');
    console.log('Commands: build, live-sync, snapshots, rebuild, temporal');
    process.exit(1);
  }

  await commands[command]();
  await closePool();
}

main().catch(err => {
  console.error('Error:', err);
  closePool().then(() => process.exit(1));
});
