// Full backfill / rebuild of the OpenSearch index from PostgreSQL (§5.3).
// Used after the initial seed and any time the mapping changes or the index is
// wiped. Idempotent: documents are keyed by product id, so re-running is safe.
//
//   npm run reindex
//
// It also marks all pending outbox rows as processed at the end — a full reindex
// supersedes any queued incremental events (everything is now current in OS).

const { config } = require('./utils/config');
const { query, closePool } = require('./utils/sql-runner');
const os = require('./utils/os-client');
const { docsPage, bulkIndex } = require('./utils/indexer');

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('REINDEX — rebuild OpenSearch from PostgreSQL');
  console.log('═══════════════════════════════════════════════════════\n');

  await os.waitForCluster();
  console.log('Recreating index (drop + create from attribute metadata)...');
  await os.createIndex({ force: true });

  const { rows: totalRows } = await query(`SELECT COUNT(*)::int AS n FROM products`);
  const total = totalRows[0].n;
  console.log(`Backfilling ${total.toLocaleString()} products...`);

  await os.setBulkMode(true); // no mid-load refreshes
  const start = Date.now();
  let afterId = 0;
  let done = 0;
  try {
    for (;;) {
      const docs = await docsPage(afterId, config.sync.bulkSize);
      if (docs.length === 0) break;
      await bulkIndex(docs);
      afterId = docs[docs.length - 1].id;
      done += docs.length;
      process.stdout.write(`\r  indexed ${done.toLocaleString()} / ${total.toLocaleString()}   `);
    }
  } finally {
    await os.setBulkMode(false);
    await os.refresh();
  }
  process.stdout.write('\n');

  // A full rebuild supersedes queued incremental events.
  await query(`UPDATE outbox SET processed_at = now() WHERE processed_at IS NULL`);

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const count = await os.docCount();
  console.log(`\nDone: ${count.toLocaleString()} docs in index in ${secs}s.`);
  await closePool();
}

main().catch((err) => {
  console.error('Reindex failed:', err.message);
  closePool().then(() => process.exit(1));
});
