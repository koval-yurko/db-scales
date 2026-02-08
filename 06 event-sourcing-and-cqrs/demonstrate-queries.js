const { query, timedQuery, closePool } = require('./utils/sql-runner');

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('QUERY PERFORMANCE COMPARISON');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = [];

  // Detect current phase
  let hasProjections = false;
  let hasTriggers = false;
  let hasSnapshots = false;

  try {
    const r = await query('SELECT COUNT(*) AS cnt FROM proj_account_balances');
    hasProjections = parseInt(r.rows[0].cnt) > 0;
  } catch {}
  try {
    const r = await query(`
      SELECT COUNT(*) AS cnt FROM pg_trigger t
      WHERE t.tgrelid = 'account_events'::regclass AND NOT t.tgisinternal
    `);
    hasTriggers = parseInt(r.rows[0].cnt) > 0;
  } catch {}
  try {
    const r = await query('SELECT COUNT(*) AS cnt FROM account_snapshots');
    hasSnapshots = parseInt(r.rows[0].cnt) > 0;
  } catch {}

  const phase = hasSnapshots ? 4 : hasTriggers ? 3 : hasProjections ? 2 : 1;
  console.log(`  Detected phase: ${phase} (projections: ${hasProjections}, triggers: ${hasTriggers}, snapshots: ${hasSnapshots})\n`);

  // ─── Query 1: Single Account Balance ───
  console.log('Query 1: Single Account Balance');
  console.log('───────────────────────────────');

  const { result: es1, duration: esd1 } = await timedQuery(`
    SELECT balance_after AS current_balance
    FROM account_events WHERE account_id = 1
    ORDER BY sequence_number DESC LIMIT 1
  `);
  console.log(`  Event Store:  $${es1.rows[0]?.current_balance}  (${esd1}ms)`);

  if (hasProjections) {
    const { result: p1, duration: pd1 } = await timedQuery(`
      SELECT current_balance FROM proj_account_balances WHERE account_id = 1
    `);
    const speedup = esd1 > 0 ? (esd1 / Math.max(pd1, 0.1)).toFixed(1) : '-';
    console.log(`  Projection:   $${p1.rows[0]?.current_balance}  (${pd1}ms)  ${speedup}x faster`);
    results.push({ query: 'Single Account Balance', es: esd1, proj: pd1 });
  }

  // ─── Query 2: All Account Balances ───
  console.log('\nQuery 2: All Account Balances');
  console.log('─────────────────────────────');

  const { result: es2, duration: esd2 } = await timedQuery(`
    SELECT DISTINCT ON (account_id) account_id, balance_after AS current_balance
    FROM account_events ORDER BY account_id, sequence_number DESC
  `);
  console.log(`  Event Store:  ${es2.rowCount} accounts  (${esd2}ms)`);

  if (hasProjections) {
    const { result: p2, duration: pd2 } = await timedQuery(`
      SELECT account_id, current_balance FROM proj_account_balances ORDER BY account_id
    `);
    const speedup = esd2 > 0 ? (esd2 / Math.max(pd2, 0.1)).toFixed(1) : '-';
    console.log(`  Projection:   ${p2.rowCount} accounts  (${pd2}ms)  ${speedup}x faster`);
    results.push({ query: 'All Account Balances', es: esd2, proj: pd2 });
  }

  // ─── Query 3: Monthly Summary ───
  console.log('\nQuery 3: Monthly Summary (Account 1)');
  console.log('─────────────────────────────────────');

  const { result: es3, duration: esd3 } = await timedQuery(`
    SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS tx_count,
      SUM(CASE WHEN event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
          THEN amount ELSE 0 END) AS total_credits,
      SUM(CASE WHEN event_type IN ('money_withdrawn','transfer_sent','fee_charged')
          THEN amount ELSE 0 END) AS total_debits
    FROM account_events WHERE account_id = 1
    GROUP BY DATE_TRUNC('month', created_at) ORDER BY month
  `);
  console.log(`  Event Store:  ${es3.rowCount} months  (${esd3}ms)`);

  if (hasProjections) {
    const { result: p3, duration: pd3 } = await timedQuery(`
      SELECT statement_month, total_credits, total_debits, transaction_count
      FROM proj_monthly_statements WHERE account_id = 1 ORDER BY statement_month
    `);
    const speedup = esd3 > 0 ? (esd3 / Math.max(pd3, 0.1)).toFixed(1) : '-';
    console.log(`  Projection:   ${p3.rowCount} months  (${pd3}ms)  ${speedup}x faster`);
    results.push({ query: 'Monthly Summary', es: esd3, proj: pd3 });
  }

  // ─── Query 4: Transaction History (last 20) ───
  console.log('\nQuery 4: Transaction History (Account 1, last 20)');
  console.log('──────────────────────────────────────────────────');

  const { result: es4, duration: esd4 } = await timedQuery(`
    SELECT event_type, amount, balance_after, metadata->>'description' AS description, created_at
    FROM account_events WHERE account_id = 1
    ORDER BY sequence_number DESC LIMIT 20
  `);
  console.log(`  Event Store:  ${es4.rowCount} rows  (${esd4}ms)`);

  if (hasProjections) {
    const { result: p4, duration: pd4 } = await timedQuery(`
      SELECT event_type, debit, credit, balance_after, description, created_at
      FROM proj_transaction_history WHERE account_id = 1
      ORDER BY created_at DESC LIMIT 20
    `);
    const speedup = esd4 > 0 ? (esd4 / Math.max(pd4, 0.1)).toFixed(1) : '-';
    console.log(`  Projection:   ${p4.rowCount} rows  (${pd4}ms)  ${speedup}x faster`);
    results.push({ query: 'Transaction History (20)', es: esd4, proj: pd4 });
  }

  // ─── Query 5: Top Accounts ───
  console.log('\nQuery 5: Top 10 Accounts by Balance');
  console.log('────────────────────────────────────');

  const { result: es5, duration: esd5 } = await timedQuery(`
    SELECT DISTINCT ON (account_id) account_id, balance_after AS current_balance
    FROM account_events ORDER BY account_id, sequence_number DESC
  `);
  // Sort in JS for the event store version
  const sorted = es5.rows.sort((a, b) => parseFloat(b.current_balance) - parseFloat(a.current_balance)).slice(0, 10);
  console.log(`  Event Store:  top=${sorted[0]?.current_balance}  (${esd5}ms)`);

  if (hasProjections) {
    const { result: p5, duration: pd5 } = await timedQuery(`
      SELECT account_number, holder_name, current_balance
      FROM proj_account_balances ORDER BY current_balance DESC LIMIT 10
    `);
    const speedup = esd5 > 0 ? (esd5 / Math.max(pd5, 0.1)).toFixed(1) : '-';
    console.log(`  Projection:   top=$${p5.rows[0]?.current_balance}  (${pd5}ms)  ${speedup}x faster`);
    results.push({ query: 'Top 10 by Balance', es: esd5, proj: pd5 });
  }

  // ─── Query 6: Temporal Query ───
  console.log('\nQuery 6: Temporal — Balance 6 Months Ago (Account 1)');
  console.log('────────────────────────────────────────────────────');

  const { result: es6, duration: esd6 } = await timedQuery(`
    SELECT balance_after AS balance_at_date
    FROM account_events WHERE account_id = 1
      AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
    ORDER BY sequence_number DESC LIMIT 1
  `);
  console.log(`  Event Store:  $${es6.rows[0]?.balance_at_date || 'N/A'}  (${esd6}ms)`);

  if (hasSnapshots) {
    const { result: p6, duration: pd6 } = await timedQuery(`
      WITH snapshot AS (
        SELECT snapshot_sequence, balance FROM account_snapshots
        WHERE account_id = 1
          AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
        ORDER BY snapshot_sequence DESC LIMIT 1
      ),
      delta AS (
        SELECT balance_after FROM account_events
        WHERE account_id = 1
          AND sequence_number > COALESCE((SELECT snapshot_sequence FROM snapshot), 0)
          AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
        ORDER BY sequence_number DESC LIMIT 1
      )
      SELECT COALESCE(
        (SELECT balance_after FROM delta),
        (SELECT balance FROM snapshot)
      ) AS balance_at_date
    `);
    const speedup = esd6 > 0 ? (esd6 / Math.max(pd6, 0.1)).toFixed(1) : '-';
    console.log(`  Snapshot:     $${p6.rows[0]?.balance_at_date || 'N/A'}  (${pd6}ms)  ${speedup}x faster`);
    results.push({ query: 'Temporal (6mo ago)', es: esd6, proj: pd6 });
  }

  // ─── Query 7: Audit Trail ───
  console.log('\nQuery 7: Audit Trail (Account 1)');
  console.log('─────────────────────────────────');

  const { result: es7, duration: esd7 } = await timedQuery(`
    SELECT sequence_number, event_type, amount, balance_after, created_at
    FROM account_events WHERE account_id = 1 ORDER BY sequence_number
  `);
  console.log(`  Full audit trail: ${es7.rowCount} events  (${esd7}ms)`);

  // ─── Query 8: Transfer Chain ───
  console.log('\nQuery 8: Transfer Chain Tracking');
  console.log('────────────────────────────────');

  const { result: es8, duration: esd8 } = await timedQuery(`
    SELECT ae.account_id, a.account_number, ae.event_type, ae.amount,
           ae.metadata->>'transfer_id' AS transfer_id
    FROM account_events ae
    JOIN accounts a ON ae.account_id = a.id
    WHERE ae.metadata->>'transfer_id' = (
      SELECT metadata->>'transfer_id' FROM account_events
      WHERE metadata->>'transfer_id' IS NOT NULL LIMIT 1
    )
    ORDER BY ae.created_at
  `);
  console.log(`  Transfer chain: ${es8.rowCount} events  (${esd8}ms)`);
  for (const row of es8.rows) {
    console.log(`    ${row.account_number} ${row.event_type.padEnd(20)} $${row.amount}  (${row.transfer_id})`);
  }

  // ─── Summary Table ───
  if (results.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`  ${'#'.padEnd(3)} ${'Query'.padEnd(28)} ${'Event Store'.padStart(12)} ${'Projection'.padStart(12)} ${'Speedup'.padStart(8)}`);
    console.log(`  ${'─'.repeat(3)} ${'─'.repeat(28)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(8)}`);
    results.forEach((r, i) => {
      const speedup = r.es > 0 ? (r.es / Math.max(r.proj, 0.1)).toFixed(1) + 'x' : '-';
      console.log(`  ${String(i + 1).padEnd(3)} ${r.query.padEnd(28)} ${(r.es + 'ms').padStart(12)} ${(r.proj + 'ms').padStart(12)} ${speedup.padStart(8)}`);
    });
  }

  console.log('');
  await closePool();
}

main().catch(err => {
  console.error('Error:', err);
  closePool().then(() => process.exit(1));
});
