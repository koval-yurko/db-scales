// REST API + UI. Writes go to PostgreSQL (+outbox); reads come from OpenSearch.
// This split is the whole point: the same filter/sort the EAV demo (`07`) served
// with N SQL self-joins is answered here by one OpenSearch query — plus facets
// and full-text for free.

const path = require('path');
const express = require('express');
const { config } = require('./utils/config');
const { closePool } = require('./utils/sql-runner');
const { buildProductQuery } = require('./utils/os-query-builder');
const { generateProducts } = require('./utils/data-generator');
const { drainAll } = require('./utils/sync-core');
const os = require('./utils/os-client');
const repo = require('./utils/repository');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let META = {}; // code -> attribute metadata, loaded at startup

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// If ?wait=1, synchronously flush the outbox to OpenSearch so the caller sees the
// write reflected in search immediately (hides eventual-consistency lag for the UI).
async function maybeWait(req) {
  if (req.query.wait === '1' || req.query.wait === 'true') {
    await drainAll();
    await os.refresh();
    return true;
  }
  return false;
}

const docToItem = (src) => ({
  id: src.id, sku: src.sku, name: src.name,
  price: src.price, category: src.category, attributes: src.attr || {},
});

// ---- metadata (PostgreSQL) --------------------------------------------------

app.get('/api/categories', wrap(async (req, res) => {
  res.json(await repo.getCategoriesWithAttributes());
}));

app.get('/api/attributes', wrap(async (req, res) => {
  res.json(await repo.getAllAttributes());
}));

// Distinct values for a text attribute (dropdowns) — served by an OpenSearch
// terms aggregation, falling back to a PG DISTINCT if the index isn't ready.
app.get('/api/attributes/:code/values', wrap(async (req, res) => {
  const code = req.params.code;
  const meta = META[code];
  if (!meta || meta.data_type !== 'text') return res.json([]);
  try {
    const { body } = await os.getClient().search({
      index: os.INDEX,
      body: { size: 0, aggs: { vals: { terms: { field: `attr.${code}`, size: 500 } } } },
    });
    res.json(body.aggregations.vals.buckets.map((b) => b.key));
  } catch (e) {
    res.json(await repo.distinctTextValues(code));
  }
}));

// ---- products: dynamic filter + sort + facets + full-text (OpenSearch) ------

app.get('/api/products', wrap(async (req, res) => {
  const q = buildProductQuery(req.query, META);

  const start = Date.now();
  const { body } = await os.getClient().search({ index: os.INDEX, body: q.body });
  const ms = Date.now() - start;

  const out = {
    items: body.hits.hits.map((h) => docToItem(h._source)),
    total: body.hits.total.value,
    page: q.page,
    limit: q.limit,
    filters: q.filters,
    took: body.took,
    ms,
  };
  if (body.aggregations) out.facets = shapeFacets(body.aggregations);
  if (req.query.explain) out.query = q.body; // the generated OpenSearch query body

  res.json(out);
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  try {
    const { body } = await os.getClient().get({ index: os.INDEX, id: String(req.params.id) });
    return res.json(docToItem(body._source));
  } catch (e) {
    if (!e.meta || e.meta.statusCode !== 404) throw e;
    // Not indexed yet — fall back to the source of truth.
    const p = await repo.getProduct(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    return res.json({ id: p.id, sku: p.sku, name: p.name, price: p.price, category: p.category, attributes: p.attr });
  }
}));

app.post('/api/products', wrap(async (req, res) => {
  const created = await repo.createProduct(req.body);
  const indexed = await maybeWait(req);
  res.status(201).json({ ...created, attributes: created.attr, indexed });
}));

app.put('/api/products/:id', wrap(async (req, res) => {
  const p = await repo.updateProduct(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'not found' });
  const indexed = await maybeWait(req);
  res.json({ ...p, attributes: p.attr, indexed });
}));

app.delete('/api/products/:id', wrap(async (req, res) => {
  const ok = await repo.deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await maybeWait(req);
  res.json({ deleted: true });
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
  const indexed = await maybeWait(req);
  res.status(201).json({ inserted, category: seedConfig.category, indexed, ms: Date.now() - start });
}));

// ---- sync status (observability) --------------------------------------------

app.get('/api/sync/status', wrap(async (req, res) => {
  const [pending, docs] = await Promise.all([repo.pendingOutboxCount(), os.docCount()]);
  res.json({ pendingOutbox: pending, indexedDocs: docs });
}));

// ---- helpers ----------------------------------------------------------------

// Turn raw OpenSearch aggregations into a compact sidebar shape.
function shapeFacets(aggs) {
  const out = {};
  for (const [name, agg] of Object.entries(aggs)) {
    if (agg.buckets) out[name] = agg.buckets.map((b) => ({ value: b.key, count: b.doc_count }));
    else out[name] = { min: agg.min, max: agg.max, avg: agg.avg, count: agg.count }; // stats
  }
  return out;
}

// ---- error handler ----------------------------------------------------------

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

async function start() {
  META = await repo.loadAttributeMeta();
  await os.waitForCluster();
  if (!(await os.indexExists())) {
    console.warn(`⚠ OpenSearch index '${os.INDEX}' not found — run \`npm run setup\` or \`npm run reindex\`.`);
  }
  app.listen(config.api.port, () => {
    console.log(`Hybrid EAV+OpenSearch API + UI on http://localhost:${config.api.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  closePool().then(() => process.exit(1));
});
