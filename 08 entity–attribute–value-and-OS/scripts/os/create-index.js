// (Re)create the OpenSearch index + mapping from attribute metadata (§4.2).
//
//   npm run os:create           # create if missing
//   npm run os:create -- --force # drop and recreate (mapping changes)
//
// Does NOT load data — run `npm run reindex` to backfill documents.

const { closePool } = require('../../utils/sql-runner');
const os = require('../../utils/os-client');

async function main() {
  const force = process.argv.includes('--force');
  await os.waitForCluster();
  const res = await os.createIndex({ force });
  if (res.created) console.log(`Created index '${os.INDEX}'.`);
  else console.log(`Index '${os.INDEX}' ${res.reason} (use --force to recreate).`);
  await closePool();
}

main().catch((err) => {
  console.error('create-index failed:', err.message);
  closePool().then(() => process.exit(1));
});
