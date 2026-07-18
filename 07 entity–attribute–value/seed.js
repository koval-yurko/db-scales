// Configurable batch generation from the CLI.
//
//   node seed.js --category laptops --count 500
//   node seed.js --category tshirts --count 1000 --attrs size,color
//   node seed.js --config seed.config.json
//
// --config loads the full seed-config object (category, count, attributes with
// value sets / ranges / probabilities, priceRange). CLI flags override it.

const fs = require('fs');
const { generateProducts } = require('./utils/data-generator');
const { insertProductsBatch } = require('./utils/repository');
const { closePool } = require('./utils/sql-runner');
const { config } = require('./utils/config');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let seedConfig = {
    category: config.seed.defaultCategory,
    count: config.seed.products,
  };

  if (args.config) {
    seedConfig = { ...seedConfig, ...JSON.parse(fs.readFileSync(args.config, 'utf8')) };
  }
  if (args.category) seedConfig.category = args.category;
  if (args.count) seedConfig.count = parseInt(args.count, 10);

  // --attrs a,b,c  -> whitelist those attributes (enabled), others omitted.
  if (args.attrs) {
    seedConfig.attributes = {};
    for (const code of args.attrs.split(',')) {
      seedConfig.attributes[code.trim()] = { enabled: true };
    }
  }

  console.log(`Generating ${seedConfig.count} '${seedConfig.category}' products...`);
  if (seedConfig.attributes) {
    console.log(`  attributes: ${Object.keys(seedConfig.attributes).join(', ')}`);
  }

  const products = generateProducts(seedConfig);
  const start = Date.now();
  const n = await insertProductsBatch(products, {
    onProgress: (done, tot) => {
      if (done % 1000 === 0 || done === tot) {
        process.stdout.write(`\r  inserted ${done} / ${tot}   `);
      }
    },
  });
  process.stdout.write('\n');
  console.log(`Done: ${n} products in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  await closePool();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  closePool().then(() => process.exit(1));
});
