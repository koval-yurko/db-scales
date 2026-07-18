// Category-specific product + attribute generators.
//
// The catalog below is the source of truth for what attributes each category
// has and how their values are produced. `generateProducts(seedConfig)` is
// shared by the initial setup, the `seed` CLI, and the `POST /api/seed` route.

// ---- small random helpers ---------------------------------------------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const rand6 = () => Math.random().toString(36).slice(2, 8);

function randDate(startYear, endYear) {
  const y = randInt(startYear, endYear);
  const m = randInt(1, 12);
  const d = randInt(1, 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function genIsbn() {
  let core = '';
  for (let i = 0; i < 12; i++) core += randInt(0, 9);
  return `978-${core[0]}-${core.slice(1, 4)}-${core.slice(4, 9)}-${core.slice(9, 10)}`;
}

// ---- value pools ------------------------------------------------------------
const AUTHORS = ['Ada Byron', 'Grace Hopper', 'Alan Kay', 'Barbara Liskov',
  'Donald Knuth', 'Leslie Lamport', 'Margaret Hamilton', 'Ken Thompson'];
const BOOK_TITLES = ['The Silent', 'Distributed', 'Quiet', 'Crimson', 'Northern',
  'Broken', 'Hidden', 'Endless', 'Autumn', 'Iron'];
const BOOK_NOUNS = ['Ledger', 'Protocol', 'Garden', 'Machine', 'River', 'Empire',
  'Signal', 'Harvest', 'Compass', 'Archive'];
const COLORS = ['red', 'blue', 'green', 'black', 'white', 'navy', 'grey', 'yellow'];
const MATERIALS = ['cotton', 'polyester', 'wool', 'linen', 'bamboo'];
const SIZES = ['S', 'M', 'L', 'XL'];
const CPUS = ['Ryzen 5', 'Ryzen 7', 'Ryzen 9', 'Core i5', 'Core i7', 'Core i9',
  'M2', 'M3'];
const LAPTOP_LINES = ['UltraBook', 'ProBook', 'ZenBook', 'ThinkLite', 'AeroEdge'];

// ---- catalog: per-category attribute generators -----------------------------
// Each attribute: { type, gen(override) }. gen honours per-call overrides
// (values / min / max / prob) coming from the seed config.
const CATALOG = {
  books: {
    prefix: 'BK',
    priceRange: { min: 8, max: 60 },
    name: () => `${pick(BOOK_TITLES)} ${pick(BOOK_NOUNS)}`,
    attributes: {
      author:    { type: 'text',   gen: (o) => pick(o.values || AUTHORS) },
      pages:     { type: 'number', gen: (o) => o.values ? pick(o.values) : randInt(o.min ?? 80, o.max ?? 1200) },
      isbn:      { type: 'text',   gen: () => genIsbn() },
      published: { type: 'date',   gen: () => randDate(1950, 2025) },
    },
  },
  tshirts: {
    prefix: 'TS',
    priceRange: { min: 10, max: 120 },
    name: () => `${pick(COLORS)} ${pick(MATERIALS)} tee`,
    attributes: {
      size:     { type: 'text', gen: (o) => pick(o.values || SIZES) },
      color:    { type: 'text', gen: (o) => pick(o.values || COLORS) },
      material: { type: 'text', gen: (o) => pick(o.values || MATERIALS) },
      organic:  { type: 'bool', gen: (o) => Math.random() < (o.prob ?? 0.3) },
    },
  },
  laptops: {
    prefix: 'LP',
    priceRange: { min: 300, max: 3000 },
    name: () => `${pick(LAPTOP_LINES)} ${randInt(13, 17)}`,
    attributes: {
      cpu:         { type: 'text',   gen: (o) => pick(o.values || CPUS) },
      ram_gb:      { type: 'number', gen: (o) => pick(o.values || [8, 16, 32, 64]) },
      tdp_w:       { type: 'number', gen: (o) => o.values ? pick(o.values) : randInt(o.min ?? 15, o.max ?? 125) },
      touchscreen: { type: 'bool',   gen: (o) => Math.random() < (o.prob ?? 0.3) },
    },
  },
};

function listCategories() {
  return Object.keys(CATALOG);
}

// Resolve which attributes to generate for a call.
//   - no `attributes` override  -> every catalog attribute (full seed)
//   - override present          -> whitelist: only listed attrs with enabled !== false
function resolveAttributes(catDef, overrides) {
  const out = [];
  for (const [code, def] of Object.entries(catDef.attributes)) {
    let ov;
    if (!overrides) {
      ov = {};
    } else if (overrides[code] && overrides[code].enabled !== false) {
      ov = overrides[code];
    } else {
      continue; // omitted or disabled -> attribute left absent (sparse by design)
    }
    out.push({ code, type: def.type, gen: def.gen, ov });
  }
  return out;
}

/**
 * Generate an array of product objects (not yet persisted):
 *   { sku, name, categoryCode, price, attrs: [{ code, type, value }] }
 *
 * seedConfig:
 *   { category, count, attributes?, priceRange? }
 */
function generateProducts(seedConfig) {
  const { category, count } = seedConfig;
  const catDef = CATALOG[category];
  if (!catDef) {
    throw new Error(`Unknown category '${category}'. Known: ${listCategories().join(', ')}`);
  }
  if (seedConfig.attributes) {
    for (const code of Object.keys(seedConfig.attributes)) {
      if (!catDef.attributes[code]) {
        throw new Error(`Attribute '${code}' is not valid for category '${category}'.`);
      }
    }
  }

  const priceRange = seedConfig.priceRange || catDef.priceRange;
  const attrPlan = resolveAttributes(catDef, seedConfig.attributes);
  const batch = rand6();
  const products = [];

  for (let i = 0; i < count; i++) {
    const price = (randInt(priceRange.min * 100, priceRange.max * 100) / 100).toFixed(2);
    const attrs = attrPlan.map(({ code, type, gen, ov }) => ({
      code,
      type,
      value: gen(ov),
    }));
    products.push({
      sku: `${catDef.prefix}-${batch}-${i}`,
      name: catDef.name(),
      categoryCode: category,
      price,
      attrs,
    });
  }
  return products;
}

module.exports = { generateProducts, listCategories, CATALOG };
