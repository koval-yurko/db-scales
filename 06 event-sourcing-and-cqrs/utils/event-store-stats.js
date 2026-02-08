const { query } = require('./sql-runner');

async function printEventStoreStats() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('EVENT STORE STATISTICS');
  console.log('═══════════════════════════════════════════════════════\n');

  // Overall stats
  const overall = await query(`
    SELECT
      COUNT(*) AS total_events,
      COUNT(DISTINCT account_id) AS active_accounts,
      pg_size_pretty(pg_total_relation_size('account_events')) AS store_size,
      MIN(created_at)::date AS first_event,
      MAX(created_at)::date AS last_event
    FROM account_events
  `);
  const s = overall.rows[0];
  console.log(`  Total events:     ${parseInt(s.total_events).toLocaleString()}`);
  console.log(`  Active accounts:  ${s.active_accounts}`);
  console.log(`  Store size:       ${s.store_size}`);
  console.log(`  Date range:       ${s.first_event} → ${s.last_event}`);

  // Events by type
  const byType = await query(`
    SELECT
      event_type,
      COUNT(*) AS event_count,
      ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM account_events) * 100, 1) AS pct
    FROM account_events
    GROUP BY event_type
    ORDER BY event_count DESC
  `);
  console.log('\n  Events by type:');
  for (const row of byType.rows) {
    console.log(`    ${row.event_type.padEnd(22)} ${parseInt(row.event_count).toLocaleString().padStart(8)}  (${row.pct}%)`);
  }

  // Top accounts
  const topAccounts = await query(`
    SELECT account_id, COUNT(*) AS event_count
    FROM account_events
    GROUP BY account_id
    ORDER BY event_count DESC
    LIMIT 5
  `);
  console.log('\n  Top 5 accounts by activity:');
  for (const row of topAccounts.rows) {
    console.log(`    Account ${String(row.account_id).padStart(4)}: ${parseInt(row.event_count).toLocaleString()} events`);
  }

  // Check projections
  try {
    const projCount = await query(`SELECT COUNT(*) AS cnt FROM proj_account_balances`);
    console.log(`\n  Projections:      ${projCount.rows[0].cnt} account balances`);
  } catch {
    console.log('\n  Projections:      not built yet');
  }

  // Check snapshots
  try {
    const snapCount = await query(`SELECT COUNT(DISTINCT account_id) AS cnt FROM account_snapshots`);
    console.log(`  Snapshots:        ${snapCount.rows[0].cnt} accounts`);
  } catch {
    console.log('  Snapshots:        not created yet');
  }

  // Check triggers
  try {
    const triggers = await query(`
      SELECT COUNT(*) AS cnt FROM pg_trigger t
      WHERE t.tgrelid = 'account_events'::regclass AND NOT t.tgisinternal
    `);
    console.log(`  Live triggers:    ${triggers.rows[0].cnt} active`);
  } catch {
    console.log('  Live triggers:    none');
  }

  console.log('');
}

module.exports = { printEventStoreStats };
