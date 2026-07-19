// The point of the demo: the same browse/filter/sort, answered by (a) SQL EAV
// self-joins — as in `07` — and (b) a single OpenSearch query, timed side by
// side. Plus two things EAV-in-SQL cannot do cheaply: facets and full-text.

const { getPool, closePool } = require('./utils/sql-runner');
const { buildProductQuery: buildSql } = require('./utils/query-builder');
const { buildProductQuery: buildOs } = require('./utils/os-query-builder');
const { loadAttributeMeta } = require('./utils/repository');
const os = require('./utils/os-client');

async function runSql(params, meta) {
  const q = buildSql(params, meta);
  const start = Date.now();
  const [items, count] = await Promise.all([
    getPool().query(q.sql, q.values),
    getPool().query(q.countSql, q.countValues),
  ]);
  return { ms: Date.now() - start, total: count.rows[0].total, sample: items.rows.slice(0, 3), joins: (q.sql.match(/JOIN/g) || []).length };
}

async function runOs(params, meta) {
  const q = buildOs(params, meta);
  const start = Date.now();
  const { body } = await os.getClient().search({ index: os.INDEX, body: q.body });
  return {
    ms: Date.now() - start,
    took: body.took,
    total: body.hits.total.value,
    sample: body.hits.hits.slice(0, 3).map((h) => h._source),
    facets: body.aggregations,
  };
}

function heading(t) {
  console.log(`\n\n### ${t}`);
  console.log('─'.repeat(64));
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('HYBRID EAV + OPENSEARCH — SQL vs SEARCH-ENGINE, SIDE BY SIDE');
  console.log('═══════════════════════════════════════════════════════');

  await os.waitForCluster();
  const meta = await loadAttributeMeta();

  // 1) Multi-attribute filter: red AND size M AND price < 100 (t-shirts).
  heading('Multi-attribute filter — red AND size M AND price < 100 (t-shirts)');
  {
    const params = { category: 'tshirts', f_color: 'red', f_size: 'M', price_lt: '100', limit: '20' };
    const sql = await runSql(params, meta);
    const es = await runOs(params, meta);
    console.log(`  SQL EAV      : ${sql.total} rows  ${sql.ms}ms   (${sql.joins} JOINs in the query)`);
    console.log(`  OpenSearch   : ${es.total} rows  ${es.ms}ms   (took ${es.took}ms, one bool query)`);
  }

  // 2) Typed sort: laptops by RAM (numeric) desc.
  heading('Typed sort — laptops by RAM (numeric) desc');
  {
    const params = { category: 'laptops', sort: 'ram_gb', dir: 'desc', limit: '20' };
    const sql = await runSql(params, meta);
    const es = await runOs(params, meta);
    console.log(`  SQL EAV      : top RAM ${sql.sample.map((r) => r.name).length ? '' : ''}${sql.ms}ms`);
    console.log(`  OpenSearch   : ${es.ms}ms   top: ${es.sample.map((s) => `${s.name}=${s.attr.ram_gb}GB`).join(', ')}`);
  }

  // 3) Facets / aggregations — the filter sidebar in ONE round trip (OS only).
  heading('Facets — t-shirt sidebar counts (color/size/material/price) in one query');
  {
    const params = { category: 'tshirts', facets: 'color,size,material,price', limit: '0' };
    const es = await runOs(params, meta);
    console.log(`  OpenSearch   : ${es.ms}ms (took ${es.took}ms)`);
    for (const f of ['color', 'size', 'material']) {
      const buckets = es.facets[f].buckets.slice(0, 5).map((b) => `${b.key}(${b.doc_count})`).join(' ');
      console.log(`    ${f.padEnd(9)}: ${buckets}`);
    }
    const p = es.facets.price;
    console.log(`    price    : min ${p.min}  avg ${p.avg.toFixed(2)}  max ${p.max}`);
    console.log('  SQL EAV      : would need a separate GROUP BY self-join PER facet.');
  }

  // 4) Full-text + filter + sort in one query (OS only).
  heading('Full-text — search "ryzen" in laptops, price desc (OpenSearch only)');
  {
    const params = { category: 'laptops', q: 'ryzen', sort: 'price', dir: 'desc', limit: '5' };
    const es = await runOs(params, meta);
    console.log(`  OpenSearch   : ${es.total} hits  ${es.ms}ms   top: ${es.sample.map((s) => s.name).join(', ')}`);
    console.log('  SQL EAV      : full-text over attribute values is not something EAV does well.');
  }

  console.log('\nTakeaway: adding a filter adds a JOIN in EAV but only a clause in OpenSearch;');
  console.log('facets and full-text are native to the search engine and effectively free.\n');

  await closePool();
}

main().catch((err) => {
  console.error('Demo failed:', err.message);
  closePool().then(() => process.exit(1));
});
