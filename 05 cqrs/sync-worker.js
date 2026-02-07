#!/usr/bin/env node
/**
 * Phase 4: LISTEN/NOTIFY Background Sync Worker
 * Listens for PostgreSQL notifications and batch-updates read models.
 *
 * Usage: node sync-worker.js [batch_interval_ms]
 * Default batch interval: 500ms
 */

const { Client } = require('pg');
const { config } = require('./utils/config');
const { runQuery } = require('./utils/sql-runner');

const BATCH_INTERVAL_MS = parseInt(process.argv[2] || config.worker.batchIntervalMs);

let pendingOrders = [];
let pendingItems = [];
let totalProcessed = 0;
let totalFlushes = 0;
let running = true;

async function flushOrderChanges(client, orders) {
  if (orders.length === 0) return;

  // Aggregate by region
  const byRegion = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    if (!byRegion[o.region]) {
      byRegion[o.region] = { total: 0, count: 0 };
    }
    byRegion[o.region].total += parseFloat(o.total_amount);
    byRegion[o.region].count += 1;
  }

  for (const [region, agg] of Object.entries(byRegion)) {
    await client.query(`
      INSERT INTO read_revenue_by_region (region, total_revenue, order_count, avg_order_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (region) DO UPDATE SET
        total_revenue = read_revenue_by_region.total_revenue + $2,
        order_count = read_revenue_by_region.order_count + $3,
        avg_order_value = (read_revenue_by_region.total_revenue + $2) / (read_revenue_by_region.order_count + $3),
        last_updated = CURRENT_TIMESTAMP
    `, [region, agg.total, agg.count, agg.total / agg.count]);
  }

  // Aggregate by user
  const byUser = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    if (!byUser[o.user_id]) {
      byUser[o.user_id] = { total: 0, count: 0, lastOrder: o.created_at };
    }
    byUser[o.user_id].total += parseFloat(o.total_amount);
    byUser[o.user_id].count += 1;
    if (o.created_at > byUser[o.user_id].lastOrder) {
      byUser[o.user_id].lastOrder = o.created_at;
    }
  }

  for (const [userId, agg] of Object.entries(byUser)) {
    await client.query(`
      INSERT INTO read_user_spending (user_id, total_spent, order_count, avg_order_value, last_order_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        total_spent = read_user_spending.total_spent + $2,
        order_count = read_user_spending.order_count + $3,
        avg_order_value = (read_user_spending.total_spent + $2) / (read_user_spending.order_count + $3),
        last_order_at = GREATEST(read_user_spending.last_order_at, $5),
        last_updated = CURRENT_TIMESTAMP
    `, [userId, agg.total, agg.count, agg.total / agg.count, agg.lastOrder]);
  }

  // Aggregate by date
  const byDate = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const date = o.created_at ? o.created_at.substring(0, 10) : new Date().toISOString().substring(0, 10);
    if (!byDate[date]) {
      byDate[date] = { total: 0, count: 0, users: new Set() };
    }
    byDate[date].total += parseFloat(o.total_amount);
    byDate[date].count += 1;
    byDate[date].users.add(o.user_id);
  }

  for (const [date, agg] of Object.entries(byDate)) {
    await client.query(`
      INSERT INTO read_daily_stats (stat_date, order_count, total_revenue, unique_customers, avg_order_value)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (stat_date) DO UPDATE SET
        order_count = read_daily_stats.order_count + $2,
        total_revenue = read_daily_stats.total_revenue + $3,
        avg_order_value = (read_daily_stats.total_revenue + $3) / (read_daily_stats.order_count + $2),
        last_updated = CURRENT_TIMESTAMP
    `, [date, agg.count, agg.total, agg.users.size, agg.total / agg.count]);
  }
}

async function flushItemChanges(client, items) {
  if (items.length === 0) return;

  // Aggregate by product
  const byProduct = {};
  for (const item of items) {
    const pid = item.product_id;
    if (!byProduct[pid]) {
      byProduct[pid] = { totalSold: 0, totalRevenue: 0 };
    }
    byProduct[pid].totalSold += parseInt(item.quantity);
    byProduct[pid].totalRevenue += parseFloat(item.line_total);
  }

  for (const [productId, agg] of Object.entries(byProduct)) {
    await client.query(`
      INSERT INTO read_top_products (product_id, total_sold, total_revenue)
      VALUES ($1, $2, $3)
      ON CONFLICT (product_id) DO UPDATE SET
        total_sold = read_top_products.total_sold + $2,
        total_revenue = read_top_products.total_revenue + $3,
        last_updated = CURRENT_TIMESTAMP
    `, [productId, agg.totalSold, agg.totalRevenue]);
  }
}

async function flush(client) {
  const orders = pendingOrders.splice(0);
  const items = pendingItems.splice(0);

  if (orders.length === 0 && items.length === 0) return;

  const start = Date.now();

  try {
    await flushOrderChanges(client, orders);
    await flushItemChanges(client, items);

    totalProcessed += orders.length + items.length;
    totalFlushes++;
    const duration = Date.now() - start;

    console.log(`  Flush #${totalFlushes}: ${orders.length} orders + ${items.length} items in ${duration}ms (total: ${totalProcessed})`);
  } catch (err) {
    console.error(`  Flush error: ${err.message}`);
    // Re-add failed items for retry
    pendingOrders.unshift(...orders);
    pendingItems.unshift(...items);
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('CQRS SYNC WORKER (LISTEN/NOTIFY)');
  console.log('═'.repeat(60));
  console.log(`\n  Batch interval: ${BATCH_INTERVAL_MS}ms`);
  console.log('  Press Ctrl+C to stop.\n');

  // Use a dedicated client for LISTEN (must stay connected)
  const listenClient = new Client(config.db);
  await listenClient.connect();

  // Separate client for write operations
  const writeClient = new Client(config.db);
  await writeClient.connect();

  // Set up notification handlers
  listenClient.on('notification', (msg) => {
    try {
      const payload = JSON.parse(msg.payload);

      if (msg.channel === 'order_changes') {
        pendingOrders.push(payload);
      } else if (msg.channel === 'item_changes') {
        pendingItems.push(payload);
      }
    } catch (err) {
      console.error(`  Parse error: ${err.message}`);
    }
  });

  // Subscribe to channels
  await listenClient.query('LISTEN order_changes');
  await listenClient.query('LISTEN item_changes');

  console.log('  Listening on: order_changes, item_changes');
  console.log('  Waiting for notifications...\n');

  // Batch flush interval
  const flushInterval = setInterval(() => {
    if (running) {
      flush(writeClient);
    }
  }, BATCH_INTERVAL_MS);

  // Wait for shutdown signal
  await new Promise(resolve => {
    process.on('SIGINT', () => {
      running = false;
      resolve();
    });
    process.on('SIGTERM', () => {
      running = false;
      resolve();
    });
  });

  // Final flush
  console.log('\n  Shutting down — flushing pending changes...');
  clearInterval(flushInterval);
  await flush(writeClient);

  await listenClient.query('UNLISTEN *');
  await listenClient.end();
  await writeClient.end();

  console.log(`\n  Total processed: ${totalProcessed} events in ${totalFlushes} flushes.`);
  console.log('  Worker stopped.\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
