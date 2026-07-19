// PG -> OpenSearch indexer worker (§5.2).
// Drains the transactional outbox and applies the changes to OpenSearch via the
// _bulk API, then stamps the rows processed. This is the reliable, CDC-lite sync
// path: at-least-once delivery, idempotent (docs keyed by product id), and it
// reads the *current* product state so multiple queued events for one product
// collapse to one correct document. Drain logic lives in utils/sync-core.js.
//
//   npm run sync            # long-running daemon (polls every SYNC_INTERVAL_MS)
//   npm run sync -- --once  # drain the backlog once and exit (used by tests/setup)

const { config } = require('./utils/config');
const { closePool } = require('./utils/sql-runner');
const os = require('./utils/os-client');
const { drainOnce, drainAll } = require('./utils/sync-core');

async function runDaemon() {
  console.log(`Sync worker started — polling outbox every ${config.sync.intervalMs}ms`);
  for (;;) {
    try {
      let n;
      do { n = await drainOnce(); if (n) console.log(`  synced ${n} outbox row(s)`); }
      while (n === config.sync.batch); // keep going while batches come back full
    } catch (e) {
      console.error('  sync error (will retry):', e.message);
    }
    await new Promise((r) => setTimeout(r, config.sync.intervalMs));
  }
}

async function main() {
  await os.waitForCluster();
  if (!(await os.indexExists())) {
    console.log(`Index '${os.INDEX}' missing — creating it.`);
    await os.createIndex();
  }

  if (process.argv.includes('--once')) {
    const total = await drainAll();
    await os.refresh();
    console.log(`Drained ${total} outbox row(s).`);
    await closePool();
    return;
  }

  await runDaemon();
}

main().catch((err) => {
  console.error('Sync failed:', err);
  closePool().then(() => process.exit(1));
});
