// Thin wrapper around the OpenSearch client + index lifecycle helpers.
// Centralizes index creation (from the metadata-driven mapping) so setup,
// reindex, and os:create all share one code path.

const { Client } = require('@opensearch-project/opensearch');
const { config } = require('./config');
const { query } = require('./sql-runner');
const { buildIndexBody } = require('./os-mapping');
const { debug } = require('./log');

const INDEX = config.opensearch.index;
let client;

function getClient() {
  if (!client) {
    client = new Client({ node: config.opensearch.node });
  }
  return client;
}

async function attributeRows() {
  const { rows } = await query(`SELECT code, data_type FROM attributes ORDER BY id`);
  return rows;
}

async function indexExists() {
  const { body } = await getClient().indices.exists({ index: INDEX });
  return body;
}

// Create the index with a mapping built from current attribute metadata.
// force=true drops an existing index first.
async function createIndex({ force = false } = {}) {
  const os = getClient();
  if (await indexExists()) {
    if (!force) return { created: false, reason: 'already exists' };
    debug('os', `dropping existing index '${INDEX}' (force)`);
    await os.indices.delete({ index: INDEX });
  }
  const rows = await attributeRows();
  const body = buildIndexBody(rows);
  await os.indices.create({ index: INDEX, body });
  debug('os', `created index '${INDEX}' with ${rows.length} typed attr fields (mapping from attribute metadata)`);
  return { created: true, index: INDEX };
}

// Tune the index for a bulk backfill (no refreshes mid-load), and restore after.
async function setBulkMode(on) {
  await getClient().indices.putSettings({
    index: INDEX,
    body: { index: { refresh_interval: on ? '-1' : '1s' } },
  });
  debug('os', `refresh_interval set to ${on ? "'-1' (bulk load, no refreshes)" : "'1s' (normal)"}`);
}

async function refresh() {
  await getClient().indices.refresh({ index: INDEX });
  debug('os', `index '${INDEX}' refreshed (new docs now searchable)`);
}

async function docCount() {
  try {
    const { body } = await getClient().count({ index: INDEX });
    return body.count;
  } catch (e) {
    if (e.meta && e.meta.statusCode === 404) return 0; // index not created yet
    throw e;
  }
}

// Wait for the OpenSearch cluster to accept requests (used by setup after
// `docker-compose up`, where the container may still be booting).
async function waitForCluster({ retries = 30, delayMs = 1000 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      await getClient().cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      debug('os', `cluster ready at ${config.opensearch.node}`);
      return true;
    } catch (e) {
      debug('os', `cluster not ready (attempt ${i + 1}/${retries}), retrying in ${delayMs}ms`);
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = {
  INDEX, getClient, indexExists, createIndex,
  setBulkMode, refresh, docCount, waitForCluster,
};
