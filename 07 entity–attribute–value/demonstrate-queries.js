const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('./utils/sql-runner');

const QUERIES = [
  { file: '10_filter_multi_attr.sql', title: 'Multi-attribute filter — red AND size M AND price < 100 (t-shirts)' },
  { file: '11_sort_typed.sql',        title: 'Typed sort — laptops by RAM (numeric) desc' },
  { file: '12_pivot_wide.sql',        title: 'Pivot wide — reconstruct products from EAV rows' },
  { file: '13_breakdown_demo.sql',    title: 'Where EAV breaks down — 3-attribute filter = 3 self-joins' },
];

function readQuery(file) {
  const sql = fs.readFileSync(path.join(__dirname, 'scripts', 'queries', file), 'utf8');
  return sql.trim().replace(/;\s*$/, ''); // strip trailing ; so we can prefix EXPLAIN
}

async function run(sql) {
  const start = Date.now();
  const result = await getPool().query(sql);
  return { rows: result.rows, ms: Date.now() - start };
}

async function explain(sql) {
  const { rows } = await getPool().query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  return rows.map((r) => r['QUERY PLAN']);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('EAV — THE HARD QUERIES');
  console.log('═══════════════════════════════════════════════════════');

  for (const q of QUERIES) {
    const sql = readQuery(q.file);
    console.log(`\n\n### ${q.title}`);
    console.log('─'.repeat(60));

    const { rows, ms } = await run(sql);
    console.log(`rows: ${rows.length}   time: ${ms}ms`);
    if (rows.length) {
      const sample = rows.slice(0, 3).map((r) => {
        const o = { ...r };
        if (o.attributes) o.attributes = JSON.stringify(o.attributes);
        return o;
      });
      console.table(sample);
    }

    const plan = await explain(sql);
    // Show the interesting lines: node types, join methods, and estimate-vs-actual.
    console.log('EXPLAIN (ANALYZE):');
    for (const line of plan) {
      if (/Join|Scan|Sort|Aggregate|actual time|rows=/.test(line)) {
        console.log('  ' + line.trim());
      }
    }
  }

  // The stringly-typed sort trap, shown concretely.
  console.log('\n\n### Bonus — why typed columns matter (stringly-typed sort trap)');
  console.log('─'.repeat(60));
  const trap = await getPool().query(`
    SELECT v.value_number::text AS as_text
    FROM product_attribute_values v
    JOIN attributes a ON a.id = v.attribute_id
    WHERE a.code = 'ram_gb'
    GROUP BY v.value_number
    ORDER BY v.value_number::text            -- lexical sort on the text form
  `);
  console.log('  ORDER BY text  ->', trap.rows.map((r) => r.as_text).join(', '), ' (8 sorts after 64!)');

  console.log('\nDone.\n');
  await closePool();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  closePool().then(() => process.exit(1));
});
