// The outbox-draining logic, shared by the sync worker (sync.js) and the API's
// synchronous `?wait=1` path (server.js). Kept here so requiring it never starts
// a daemon.

const { config } = require('./config');
const { query } = require('./sql-runner');
const { docsForIds, bulkIndex, bulkDelete } = require('./indexer');

// Process one batch of pending outbox rows. Returns how many rows were handled.
async function drainOnce(batch = config.sync.batch) {
  const { rows } = await query(
    `SELECT id, product_id, op FROM outbox
     WHERE processed_at IS NULL
     ORDER BY id
     LIMIT $1`,
    [batch]
  );
  if (rows.length === 0) return 0;

  // Collapse to the latest op per product (rows are id-ordered → last wins).
  const latestOp = new Map();
  const outboxIds = [];
  for (const r of rows) {
    latestOp.set(String(r.product_id), r.op);
    outboxIds.push(r.id);
  }

  const upsertIds = [];
  const deleteIds = [];
  for (const [pid, op] of latestOp) {
    (op === 'delete' ? deleteIds : upsertIds).push(Number(pid));
  }

  // Build docs from CURRENT PG state. An id queued as 'upsert' but since deleted
  // won't come back → fold it into deletes (defensive).
  const docs = await docsForIds(upsertIds);
  const foundIds = new Set(docs.map((d) => d.id));
  const missingUpserts = upsertIds.filter((id) => !foundIds.has(id));

  await bulkIndex(docs);
  await bulkDelete(deleteIds.concat(missingUpserts));

  // Mark handled last: a crash before this re-processes the same rows next run,
  // harmless because every op is an idempotent upsert/delete keyed by id.
  await query(`UPDATE outbox SET processed_at = now() WHERE id = ANY($1)`, [outboxIds]);

  return rows.length;
}

// Drain the whole backlog (used by --once and ?wait=1).
async function drainAll() {
  let total = 0, n;
  do { n = await drainOnce(); total += n; } while (n > 0);
  return total;
}

module.exports = { drainOnce, drainAll };
