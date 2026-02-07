const { runQuery } = require('./sql-runner');

async function getCurrentStrategy(client) {
  const { result } = await runQuery(client, `
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname LIKE 'mv_%')
        THEN 'materialized_views'
        WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE t.tgname LIKE 'trg_%_sync' AND c.relname IN ('orders', 'order_items'))
        THEN 'triggers'
        WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE t.tgname LIKE 'trg_%_notify' AND c.relname IN ('orders', 'order_items'))
        THEN 'listen_notify'
        ELSE 'none'
      END AS current_strategy
  `);
  return result.rows[0].current_strategy;
}

async function hasReadTables(client) {
  const { result } = await runQuery(client, `
    SELECT COUNT(*) AS cnt FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('read_revenue_by_region', 'read_top_products', 'read_user_spending', 'read_daily_stats')
  `);
  return parseInt(result.rows[0].cnt) > 0;
}

async function printWriteSideStats(client) {
  console.log('\n' + '─'.repeat(40));
  console.log('Write-Side Data Volume:');
  console.log('─'.repeat(40));

  const { result } = await runQuery(client, `
    SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
    UNION ALL SELECT 'products', COUNT(*) FROM products
    UNION ALL SELECT 'orders', COUNT(*) FROM orders
    UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
    ORDER BY table_name
  `);
  console.table(result.rows);
}

async function printReadModelFreshness(client) {
  const strategy = await getCurrentStrategy(client);

  if (strategy === 'none') {
    console.log('\nNo read models active (baseline mode).');
    return;
  }

  console.log('\n' + '─'.repeat(40));
  console.log('Read Model Freshness:');
  console.log('─'.repeat(40));

  if (strategy === 'materialized_views') {
    const { result } = await runQuery(client, `
      SELECT matviewname AS view_name
      FROM pg_matviews
      WHERE matviewname LIKE 'mv_%'
      ORDER BY matviewname
    `);
    console.table(result.rows);
    console.log('  (Materialized views — refresh manually with: npm run refresh)');
  } else {
    try {
      const { result } = await runQuery(client, `
        SELECT 'read_revenue_by_region' AS model,
               COUNT(*) AS rows,
               MAX(last_updated) AS last_refreshed,
               EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER AS staleness_sec
        FROM read_revenue_by_region
        UNION ALL
        SELECT 'read_top_products', COUNT(*), MAX(last_updated),
               EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER
        FROM read_top_products
        UNION ALL
        SELECT 'read_user_spending', COUNT(*), MAX(last_updated),
               EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER
        FROM read_user_spending
        UNION ALL
        SELECT 'read_daily_stats', COUNT(*), MAX(last_updated),
               EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER
        FROM read_daily_stats
      `);
      console.table(result.rows);
    } catch {
      console.log('  Read tables not yet populated.');
    }
  }
}

async function printTriggerStatus(client) {
  console.log('\n' + '─'.repeat(40));
  console.log('Active Triggers:');
  console.log('─'.repeat(40));

  const { result } = await runQuery(client, `
    SELECT
      t.tgname AS trigger_name,
      c.relname AS table_name,
      p.proname AS function_name,
      CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled' END AS status
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE c.relname IN ('orders', 'order_items')
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `);

  if (result.rows.length === 0) {
    console.log('  No custom triggers on orders/order_items.');
  } else {
    console.table(result.rows);
  }
}

async function printCqrsStats(client) {
  const strategy = await getCurrentStrategy(client);

  console.log('\n' + '═'.repeat(60));
  console.log('CQRS STATUS');
  console.log('═'.repeat(60));
  console.log(`\nCurrent Strategy: ${strategy}`);

  await printWriteSideStats(client);
  await printReadModelFreshness(client);
  await printTriggerStatus(client);
}

module.exports = {
  getCurrentStrategy,
  hasReadTables,
  printWriteSideStats,
  printReadModelFreshness,
  printTriggerStatus,
  printCqrsStats,
};
