#!/usr/bin/env node
/**
 * Continuous Order Generator
 * Simulates production write traffic by inserting orders at a configurable rate.
 *
 * Usage: node load-data.js [interval_ms] [duration_sec]
 * Example: node load-data.js 50 120
 */

const { getClient, runQuery } = require('./utils/sql-runner');
const { selectUserForOrder, randomInt, randomElement, randomDecimal, REGIONS } = require('./utils/data-generator');
const { config } = require('./utils/config');

const INTERVAL_MS = parseInt(process.argv[2] || '100');
const DURATION_SEC = parseInt(process.argv[3] || '60');

let running = true;
let totalInserts = 0;

async function main() {
  console.log('═'.repeat(60));
  console.log('CONTINUOUS ORDER GENERATOR');
  console.log('═'.repeat(60));
  console.log(`\n  Interval: ${INTERVAL_MS}ms between inserts`);
  console.log(`  Duration: ${DURATION_SEC}s`);
  console.log('  Press Ctrl+C to stop early.\n');

  const client = await getClient();

  try {
    // Get user count and product count
    const { result: userCountResult } = await runQuery(client, `SELECT COUNT(*) AS cnt FROM users`);
    const userCount = parseInt(userCountResult.rows[0].cnt);

    const { result: prodCountResult } = await runQuery(client, `SELECT COUNT(*) AS cnt FROM products`);
    const productCount = parseInt(prodCountResult.rows[0].cnt);

    // Get user regions
    const { result: userRows } = await runQuery(client, `SELECT id, region_code FROM users`);
    const userRegions = {};
    for (const row of userRows.rows) {
      userRegions[row.id] = row.region_code;
    }

    console.log(`  Users: ${userCount}, Products: ${productCount}\n`);

    const startTime = Date.now();
    const endTime = startTime + DURATION_SEC * 1000;

    const interval = setInterval(async () => {
      if (!running || Date.now() > endTime) {
        clearInterval(interval);
        running = false;
        return;
      }

      try {
        const userId = selectUserForOrder(userCount, config.seed.hotUserPercentage);
        const region = userRegions[userId] || randomElement(REGIONS);
        const totalAmount = randomDecimal(10, 2000);

        const { result: orderResult } = await runQuery(client, `
          INSERT INTO orders (user_id, region, status, total_amount)
          VALUES ($1, $2, 'completed', $3)
          RETURNING id
        `, [userId, region, totalAmount]);

        const orderId = orderResult.rows[0].id;

        // Insert 1-5 order items
        const itemCount = randomInt(1, 5);
        const usedProducts = new Set();
        for (let i = 0; i < itemCount; i++) {
          let productId;
          do {
            productId = randomInt(1, productCount);
          } while (usedProducts.has(productId));
          usedProducts.add(productId);

          const quantity = randomInt(1, 10);
          const unitPrice = randomDecimal(5, 500);
          const lineTotal = parseFloat((quantity * unitPrice).toFixed(2));

          await runQuery(client, `
            INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
            VALUES ($1, $2, $3, $4, $5)
          `, [orderId, productId, quantity, unitPrice, lineTotal]);
        }

        totalInserts++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r  Orders: ${totalInserts} | Elapsed: ${elapsed}s | Rate: ${(totalInserts / parseFloat(elapsed)).toFixed(1)}/s`);

      } catch (err) {
        console.error(`\n  Insert error: ${err.message}`);
      }
    }, INTERVAL_MS);

    // Wait for completion
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (!running) {
          clearInterval(check);
          resolve();
        }
      }, 500);
    });

  } finally {
    const elapsed = (DURATION_SEC).toFixed(0);
    console.log(`\n\n  Done. Inserted ${totalInserts} orders in ${elapsed}s.`);
    await client.end();
  }
}

process.on('SIGINT', () => {
  running = false;
  console.log('\n  Shutting down...');
});

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
