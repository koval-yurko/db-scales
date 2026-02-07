#!/usr/bin/env node
/**
 * Sync Strategy Orchestrator
 * Manages transitions between CQRS sync strategies.
 *
 * Usage: node sync-models.js <strategy>
 *   mat-views  - Phase 2: Create materialized views
 *   refresh    - Phase 2: Refresh all materialized views
 *   triggers   - Phase 3: Drop mat views, create read tables + triggers
 *   notify     - Phase 4: Replace triggers with NOTIFY
 */

const { getClient, runSqlFile, runQuery } = require('./utils/sql-runner');
const { getCurrentStrategy, printCqrsStats } = require('./utils/cqrs-stats');

const STRATEGY = process.argv[2];

async function setupMatViews(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 2: Materialized Views');
  console.log('═'.repeat(60));
  console.log('\nPre-computed analytics — fast reads, stale between refreshes.\n');

  // Clean up any existing read tables/triggers from previous phases
  await runQuery(client, `DROP TRIGGER IF EXISTS trg_order_insert_sync ON orders`);
  await runQuery(client, `DROP TRIGGER IF EXISTS trg_item_insert_sync ON order_items`);
  await runQuery(client, `DROP TRIGGER IF EXISTS trg_order_notify ON orders`);
  await runQuery(client, `DROP TRIGGER IF EXISTS trg_item_notify ON order_items`);
  await runQuery(client, `DROP TABLE IF EXISTS read_revenue_by_region CASCADE`);
  await runQuery(client, `DROP TABLE IF EXISTS read_top_products CASCADE`);
  await runQuery(client, `DROP TABLE IF EXISTS read_user_spending CASCADE`);
  await runQuery(client, `DROP TABLE IF EXISTS read_daily_stats CASCADE`);

  // Drop existing mat views first (idempotent)
  await runQuery(client, `DROP MATERIALIZED VIEW IF EXISTS mv_revenue_by_region`);
  await runQuery(client, `DROP MATERIALIZED VIEW IF EXISTS mv_top_products`);
  await runQuery(client, `DROP MATERIALIZED VIEW IF EXISTS mv_user_spending`);
  await runQuery(client, `DROP MATERIALIZED VIEW IF EXISTS mv_daily_stats`);

  await runSqlFile(client, 'scripts/materialized-views/10_create_mat_views.sql');

  console.log('\n✓ Phase 2 Complete: 4 materialized views created');
  console.log('  Run "npm run demo" to compare read performance.');
  console.log('  Run "npm run refresh" to refresh views after writes.');
  console.log('  Run "npm run phase3" to switch to trigger-based sync.\n');
}

async function refreshMatViews(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('REFRESHING MATERIALIZED VIEWS');
  console.log('═'.repeat(60));

  await runSqlFile(client, 'scripts/materialized-views/11_refresh_views.sql');

  console.log('\n✓ All materialized views refreshed.\n');
}

async function setupTriggers(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 3: Trigger-Based Sync');
  console.log('═'.repeat(60));
  console.log('\nSynchronous read model updates — always consistent, write overhead.\n');

  // Clean up NOTIFY triggers if present
  await runQuery(client, `DROP TRIGGER IF EXISTS trg_order_notify ON orders`);
  await runQuery(client, `DROP TRIGGER IF EXISTS trg_item_notify ON order_items`);

  // Create read tables (drops mat views inside the script)
  await runSqlFile(client, 'scripts/triggers/20_create_read_tables.sql');

  // Create trigger functions and attach
  await runSqlFile(client, 'scripts/triggers/21_sync_triggers.sql');

  // Backfill read tables from existing data
  await runSqlFile(client, 'scripts/triggers/22_initial_populate.sql');

  await printCqrsStats(client);

  console.log('\n✓ Phase 3 Complete: Trigger-based sync active');
  console.log('  Run "npm run demo" to see write overhead and instant consistency.');
  console.log('  Run "npm run phase4" to switch to async LISTEN/NOTIFY.\n');
}

async function setupNotify(client) {
  console.log('\n' + '═'.repeat(60));
  console.log('PHASE 4: Async LISTEN/NOTIFY');
  console.log('═'.repeat(60));
  console.log('\nLightweight notifications + background worker — eventual consistency.\n');

  // Ensure read tables exist (creates if not, reuses if present)
  await runSqlFile(client, 'scripts/notify/31_create_read_tables.sql');

  // Check if read tables have data; if not, backfill
  const { result } = await runQuery(client, `SELECT COUNT(*) AS cnt FROM read_revenue_by_region`);
  if (parseInt(result.rows[0].cnt) === 0) {
    console.log('\nRead tables empty — backfilling from existing data...');
    await runSqlFile(client, 'scripts/triggers/22_initial_populate.sql');
  }

  // Replace sync triggers with NOTIFY triggers
  await runSqlFile(client, 'scripts/notify/30_notify_triggers.sql');

  await printCqrsStats(client);

  console.log('\n✓ Phase 4 Complete: NOTIFY triggers active');
  console.log('  Start the sync worker in a separate terminal: npm run worker');
  console.log('  Run "npm run demo" to see write overhead and sync lag.');
  console.log('  Run "npm run load" to generate continuous traffic.\n');
}

async function main() {
  if (!STRATEGY) {
    console.error('Usage: node sync-models.js <strategy>');
    console.error('Strategies: mat-views, refresh, triggers, notify');
    process.exit(1);
  }

  const client = await getClient();

  try {
    const currentStrategy = await getCurrentStrategy(client);
    console.log(`Current sync strategy: ${currentStrategy}`);

    switch (STRATEGY) {
      case 'mat-views':
        await setupMatViews(client);
        break;
      case 'refresh':
        await refreshMatViews(client);
        break;
      case 'triggers':
        await setupTriggers(client);
        break;
      case 'notify':
        await setupNotify(client);
        break;
      default:
        console.error(`Unknown strategy: ${STRATEGY}`);
        console.error('Valid: mat-views, refresh, triggers, notify');
        process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
