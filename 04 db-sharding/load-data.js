#!/usr/bin/env node
/**
 * Continuous Data Loader
 * Generates test data at a specified rate for testing under load
 */

const { getClient, runQuery } = require('./utils/sql-runner');
const { config, generateOrder, generateOrderItem, selectUserForOrder, REGIONS } = require('./utils/data-generator');

const INTERVAL_MS = parseInt(process.argv[2]) || 100;  // ms between inserts
const DURATION_SEC = parseInt(process.argv[3]) || 60;  // seconds to run

let running = true;
let insertCount = 0;
let errorCount = 0;
let startTime;

async function insertOrder(client, userCount) {
  const userId = selectUserForOrder(userCount, config.seed.hotUserPercentage);
  const region = REGIONS[Math.floor(Math.random() * REGIONS.length)].code;
  const order = generateOrder(userId, region);

  const { result } = await runQuery(client, `
    INSERT INTO orders (user_id, region, product_id, quantity, amount, status, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [order.user_id, order.region, order.product_id, order.quantity, order.amount, order.status, order.metadata]);

  const orderId = result.rows[0].id;

  // Add 1-3 order items
  const itemCount = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < itemCount; i++) {
    const item = generateOrderItem(userId, orderId);
    await runQuery(client, `
      INSERT INTO order_items (user_id, order_id, product_name, quantity, unit_price)
      VALUES ($1, $2, $3, $4, $5)
    `, [item.user_id, item.order_id, item.product_name, item.quantity, item.unit_price]);
  }

  return orderId;
}

function printStats() {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = insertCount / elapsed;
  process.stdout.write(`\r  Orders: ${insertCount} | Errors: ${errorCount} | Rate: ${rate.toFixed(1)}/sec | Elapsed: ${elapsed.toFixed(0)}s    `);
}

async function main() {
  console.log('═'.repeat(60));
  console.log('Continuous Data Loader');
  console.log('═'.repeat(60));
  console.log(`\nInterval: ${INTERVAL_MS}ms`);
  console.log(`Duration: ${DURATION_SEC}s`);
  console.log('Press Ctrl+C to stop early.\n');

  const client = await getClient();

  // Get user count for distribution
  const { result: countResult } = await runQuery(client, 'SELECT COUNT(*) FROM users');
  const userCount = parseInt(countResult.rows[0].count) || 1000;
  console.log(`Found ${userCount} users for order distribution.\n`);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nStopping...');
    running = false;
  });

  startTime = Date.now();
  const endTime = startTime + (DURATION_SEC * 1000);

  console.log('Starting continuous inserts...\n');

  try {
    while (running && Date.now() < endTime) {
      try {
        await insertOrder(client, userCount);
        insertCount++;
      } catch (err) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`\nError: ${err.message}`);
        }
      }

      printStats();

      // Wait for next interval
      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }

    // Final stats
    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n\n' + '─'.repeat(40));
    console.log('Final Statistics:');
    console.log('─'.repeat(40));
    console.log(`  Total orders inserted: ${insertCount}`);
    console.log(`  Total errors: ${errorCount}`);
    console.log(`  Total time: ${totalTime.toFixed(1)}s`);
    console.log(`  Average rate: ${(insertCount / totalTime).toFixed(1)} orders/sec`);

    // Show current counts
    const { result: summary } = await runQuery(client, `
      SELECT 'orders' as table_name, COUNT(*) as count FROM orders
      UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
    `);
    console.log('\nCurrent table counts:');
    console.table(summary.rows);

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
