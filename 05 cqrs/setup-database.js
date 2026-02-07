#!/usr/bin/env node
/**
 * Phase 1: Setup Database
 * Creates write-side tables, seeds products, users, orders, and order_items.
 */

const { getClient, runSqlFile, runQuery } = require('./utils/sql-runner');
const { config } = require('./utils/config');
const { REGIONS, selectUserForOrder, randomInt, randomElement, randomDecimal } = require('./utils/data-generator');

async function seedUsers(client, count) {
  console.log(`\nSeeding ${count} users...`);

  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    const batchCount = Math.min(batchSize, count - i);

    for (let j = 0; j < batchCount; j++) {
      const userId = i + j + 1;
      const region = randomElement(REGIONS);
      const tier = randomElement(['standard', 'premium', 'enterprise']);
      batch.push(`('user${userId}@example.com', 'User ${userId}', '${region}', '${tier}')`);
    }

    await runQuery(client, `
      INSERT INTO users (email, name, region_code, tier)
      VALUES ${batch.join(',\n')}
      ON CONFLICT (email) DO NOTHING
    `);

    inserted += batchCount;
    process.stdout.write(`\r  Inserted ${inserted}/${count} users`);
  }

  console.log(' ✓');
}

async function seedOrders(client, count, userCount) {
  console.log(`\nSeeding ${count} orders...`);

  // Preload user regions for generating orders with matching regions
  const { result: userRows } = await runQuery(client, `SELECT id, region_code FROM users`);
  const userRegions = {};
  for (const row of userRows.rows) {
    userRegions[row.id] = row.region_code;
  }

  const batchSize = 500;
  let inserted = 0;
  const orderIds = [];

  const statuses = ['pending', 'processing', 'completed', 'shipped', 'delivered', 'cancelled'];

  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    const batchCount = Math.min(batchSize, count - i);

    for (let j = 0; j < batchCount; j++) {
      const userId = selectUserForOrder(userCount, config.seed.hotUserPercentage);
      const region = userRegions[userId] || randomElement(REGIONS);
      const status = randomElement(statuses);
      const totalAmount = randomDecimal(10, 2000);
      const daysAgo = randomInt(0, 365);
      const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();

      batch.push(`(${userId}, '${region}', '${status}', ${totalAmount}, '${createdAt}', '${createdAt}')`);
    }

    const { result } = await runQuery(client, `
      INSERT INTO orders (user_id, region, status, total_amount, created_at, updated_at)
      VALUES ${batch.join(',\n')}
      RETURNING id
    `);

    for (const row of result.rows) {
      orderIds.push(row.id);
    }

    inserted += batchCount;
    process.stdout.write(`\r  Inserted ${inserted}/${count} orders`);
  }

  console.log(' ✓');
  return orderIds;
}

async function seedOrderItems(client, orderIds, productCount) {
  const totalOrders = orderIds.length;
  console.log(`\nSeeding order items for ${totalOrders} orders...`);

  const batchSize = 1000;
  let inserted = 0;
  let batch = [];

  for (let i = 0; i < orderIds.length; i++) {
    const orderId = orderIds[i];
    const itemCount = randomInt(1, 5);

    const usedProducts = new Set();
    for (let j = 0; j < itemCount; j++) {
      let productId;
      do {
        productId = randomInt(1, productCount);
      } while (usedProducts.has(productId));
      usedProducts.add(productId);

      const quantity = randomInt(1, 10);
      const unitPrice = randomDecimal(5, 500);
      const lineTotal = parseFloat((quantity * unitPrice).toFixed(2));

      batch.push(`(${orderId}, ${productId}, ${quantity}, ${unitPrice}, ${lineTotal})`);
    }

    if (batch.length >= batchSize || i === orderIds.length - 1) {
      await runQuery(client, `
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
        VALUES ${batch.join(',\n')}
      `);
      inserted += batch.length;
      batch = [];
      process.stdout.write(`\r  Inserted ${inserted} order items`);
    }
  }

  console.log(' ✓');
  return inserted;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('PHASE 1: Setup Database (Normalized OLTP Tables)');
  console.log('═'.repeat(60));
  console.log('\nCreating standard e-commerce schema.');
  console.log('Analytics queries will run via JOINs (the "before" benchmark).\n');

  const client = await getClient();

  try {
    // Create tables
    await runSqlFile(client, 'scripts/setup/00_create_tables.sql');

    // Seed products
    await runSqlFile(client, 'scripts/setup/01_seed_data.sql');

    // Get product count
    const { result: prodCount } = await runQuery(client, 'SELECT COUNT(*) AS cnt FROM products');
    const productCount = parseInt(prodCount.rows[0].cnt);
    console.log(`\n  Products seeded: ${productCount}`);

    // Seed users
    await seedUsers(client, config.seed.users);

    // Seed orders
    const orderIds = await seedOrders(client, config.seed.orders, config.seed.users);

    // Seed order items
    const itemCount = await seedOrderItems(client, orderIds, productCount);

    // Show summary
    console.log('\n' + '─'.repeat(40));
    console.log('Data Summary:');
    console.log('─'.repeat(40));

    const { result: summary } = await runQuery(client, `
      SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
      UNION ALL SELECT 'products', COUNT(*) FROM products
      UNION ALL SELECT 'orders', COUNT(*) FROM orders
      UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
      ORDER BY table_name
    `);
    console.table(summary.rows);

    // Hot user distribution
    console.log('\n' + '─'.repeat(40));
    console.log('Hot User Distribution (top 10):');
    console.log('─'.repeat(40));

    const { result: hotUsers } = await runQuery(client, `
      SELECT user_id, COUNT(*) AS order_count
      FROM orders
      GROUP BY user_id
      ORDER BY order_count DESC
      LIMIT 10
    `);
    console.table(hotUsers.rows);

    console.log('\n✓ Phase 1 Complete: Database setup with normalized tables');
    console.log('  Run "npm run demo" to see baseline query performance.');
    console.log('  Run "npm run phase2" to create materialized views.\n');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
