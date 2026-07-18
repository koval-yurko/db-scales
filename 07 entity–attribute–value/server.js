const path = require('path');
const express = require('express');
const { config } = require('./utils/config');
const { getPool, closePool } = require('./utils/sql-runner');
const { buildProductQuery } = require('./utils/query-builder');
const { generateProducts } = require('./utils/data-generator');
const repo = require('./utils/repository');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let META = {}; // code -> attribute metadata, loaded at startup

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- metadata ---------------------------------------------------------------

app.get('/api/categories', wrap(async (req, res) => {
  res.json(await repo.getCategoriesWithAttributes());
}));

app.get('/api/attributes', wrap(async (req, res) => {
  res.json(await repo.getAllAttributes());
}));

app.get('/api/attributes/:code/values', wrap(async (req, res) => {
  res.json(await repo.distinctTextValues(req.params.code));
}));

// ---- products: dynamic filter + sort ---------------------------------------

app.get('/api/products', wrap(async (req, res) => {
  const q = buildProductQuery(req.query, META);

  const start = Date.now();
  const [items, count] = await Promise.all([
    getPool().query(q.sql, q.values),
    getPool().query(q.countSql, q.countValues),
  ]);
  const ms = Date.now() - start;

  const body = {
    items: items.rows,
    total: count.rows[0].total,
    page: q.page,
    limit: q.limit,
    filters: q.filters,
    ms,
  };

  if (req.query.explain) {
    const plan = await getPool().query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, q.values);
    body.sql = q.sql;
    body.values = q.values;
    body.explain = plan.rows.map((r) => r['QUERY PLAN']);
  }

  res.json(body);
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const p = await repo.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
}));

app.post('/api/products', wrap(async (req, res) => {
  res.status(201).json(await repo.createProduct(req.body));
}));

app.put('/api/products/:id', wrap(async (req, res) => {
  const p = await repo.updateProduct(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
}));

// ---- seed -------------------------------------------------------------------

app.post('/api/seed', wrap(async (req, res) => {
  const seedConfig = {
    category: req.body.category || config.seed.defaultCategory,
    count: Math.min(parseInt(req.body.count, 10) || 100, 50000),
    attributes: req.body.attributes,
    priceRange: req.body.priceRange,
  };
  const products = generateProducts(seedConfig);
  const start = Date.now();
  const inserted = await repo.insertProductsBatch(products);
  res.status(201).json({ inserted, category: seedConfig.category, ms: Date.now() - start });
}));

// ---- error handler ----------------------------------------------------------

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

async function start() {
  META = await repo.loadAttributeMeta();
  app.listen(config.api.port, () => {
    console.log(`EAV catalog API + UI on http://localhost:${config.api.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  closePool().then(() => process.exit(1));
});
