// One-shot setup: build the PostgreSQL write model (schema + seed), then build
// the OpenSearch read model (create index + full backfill). Leaves both stores
// consistent so `npm run demo` / `npm run api` work immediately.

const { runSQL, query, closePool } = require('./utils/sql-runner');
const { generateProducts, listCategories } = require('./utils/data-generator');
const { insertProductsBatch } = require('./utils/repository');
const { config } = require('./utils/config');
const os = require('./utils/os-client');
const { docsPage, bulkIndex } = require('./utils/indexer');

async function backfillOpenSearch() {
  await os.waitForCluster();
  await os.createIndex({ force: true });

  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM products`);
  const total = rows[0].n;

  await os.setBulkMode(true);
  let afterId = 0, done = 0;
  try {
    for (;;) {
      const docs = await docsPage(afterId, config.sync.bulkSize);
      if (docs.length === 0) break;
      await bulkIndex(docs);
      afterId = docs[docs.length - 1].id;
      done += docs.length;
      if (done % 5000 === 0 || done === total) {
        process.stdout.write(`\r  indexed ${done.toLocaleString()} / ${total.toLocaleString()}   `);
      }
    }
  } finally {
    await os.setBulkMode(false);
    await os.refresh();
  }
  process.stdout.write('\n');
  // Initial docs are now all in OpenSearch; clear the outbox events they created.
  await query(`UPDATE outbox SET processed_at = now() WHERE processed_at IS NULL`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('HYBRID EAV + OPENSEARCH — SETUP');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('Step 1: Creating PostgreSQL schema (+ outbox)...');
  await runSQL('scripts/setup/00_create_schema.sql', 'Create schema');

  console.log('\nStep 2: Seeding categories + attribute metadata...');
  await runSQL('scripts/setup/01_seed_categories.sql', 'Seed categories');

  const cats = listCategories();
  const total = config.seed.products;
  const per = Math.floor(total / cats.length);
  console.log(`\nStep 3: Generating ${total.toLocaleString()} products (${per.toLocaleString()} per category)...`);

  const start = Date.now();
  let grandTotal = 0;
  for (const category of cats) {
    const products = generateProducts({ category, count: per });
    const n = await insertProductsBatch(products, {
      onProgress: (done) => {
        if (done % 5000 === 0 || done === products.length) {
          process.stdout.write(`\r  ${category}: ${done.toLocaleString()} / ${products.length.toLocaleString()}   `);
        }
      },
    });
    grandTotal += n;
    process.stdout.write('\n');
  }
  console.log(`  Inserted ${grandTotal.toLocaleString()} products in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  console.log('\nStep 4: Building OpenSearch index + backfilling documents...');
  await backfillOpenSearch();

  console.log('\n─── Stats ───────────────────────────────────────────');
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM products)                  AS products,
      (SELECT COUNT(*) FROM product_attribute_values)  AS attribute_values,
      (SELECT COUNT(*) FROM attributes)                AS attributes,
      (SELECT COUNT(*) FROM categories)                AS categories
  `);
  const s = stats.rows[0];
  const docs = await os.docCount();
  console.log(`  Categories:        ${s.categories}`);
  console.log(`  Attributes (meta): ${s.attributes}`);
  console.log(`  Products (PG):     ${Number(s.products).toLocaleString()}`);
  console.log(`  EAV value rows:    ${Number(s.attribute_values).toLocaleString()}`);
  console.log(`  OpenSearch docs:   ${Number(docs).toLocaleString()}`);

  console.log('\n  Setup complete. Next: `npm run demo`, `npm run api`, or `npm run sync`\n');
  await closePool();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  closePool().then(() => process.exit(1));
});
