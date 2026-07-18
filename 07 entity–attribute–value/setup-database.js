const { runSQL, query, closePool } = require('./utils/sql-runner');
const { generateProducts, listCategories } = require('./utils/data-generator');
const { insertProductsBatch } = require('./utils/repository');
const { config } = require('./utils/config');

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('EAV CATALOG — DATABASE SETUP');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('Step 1: Creating schema...');
  await runSQL('scripts/setup/00_create_schema.sql', 'Create schema');

  console.log('\nStep 2: Seeding categories + attribute metadata...');
  await runSQL('scripts/setup/01_seed_categories.sql', 'Seed categories');

  // Step 3: generate + insert products, split evenly across categories,
  // each with its FULL attribute set.
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
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Inserted ${grandTotal.toLocaleString()} products in ${secs}s`);

  console.log('\nStep 4: Creating indexes + analyzing...');
  await runSQL('scripts/setup/02_create_indexes.sql', 'Create indexes');

  // Step 5: stats
  console.log('\n─── Stats ───────────────────────────────────────────');
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM products)                  AS products,
      (SELECT COUNT(*) FROM product_attribute_values)  AS attribute_values,
      (SELECT COUNT(*) FROM attributes)                AS attributes,
      (SELECT COUNT(*) FROM categories)                AS categories
  `);
  const s = stats.rows[0];
  console.log(`  Categories:        ${s.categories}`);
  console.log(`  Attributes (meta): ${s.attributes}`);
  console.log(`  Products:          ${Number(s.products).toLocaleString()}`);
  console.log(`  EAV value rows:    ${Number(s.attribute_values).toLocaleString()}`);

  console.log('\n  Setup complete. Next: `npm run demo` or `npm run api`\n');
  await closePool();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  closePool().then(() => process.exit(1));
});
