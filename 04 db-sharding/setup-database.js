#!/usr/bin/env node
/**
 * Phase 1: Setup Database
 * Creates base tables and seeds initial data (regular PostgreSQL, NO Citus yet)
 */

const { getClient, runSqlFile, runQuery } = require('./utils/sql-runner');
const { config, REGIONS, generateUser, generateOrder, generateOrderItem, selectUserForOrder } = require('./utils/data-generator');
const { printShardStats } = require('./utils/shard-stats');

async function seedUsers(client, count) {
  console.log(`\nSeeding ${count} users...`);

  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    const batchCount = Math.min(batchSize, count - i);

    for (let j = 0; j < batchCount; j++) {
      const userId = i + j + 1;
      const user = generateUser(userId);
      batch.push(`('${user.email}', '${user.name}', '${user.region_code}', '${user.tier}')`);
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

async function seedOrders(client, orderCount, userCount) {
  console.log(`\nSeeding ${orderCount} orders...`);

  // Get user regions for order generation
  const { result: usersResult } = await runQuery(client, 'SELECT id, region_code FROM users');
  const userRegions = {};
  usersResult.rows.forEach(row => {
    userRegions[row.id] = row.region_code;
  });

  const batchSize = 500;
  let inserted = 0;
  const orderIds = [];

  for (let i = 0; i < orderCount; i += batchSize) {
    const batch = [];
    const batchCount = Math.min(batchSize, orderCount - i);

    for (let j = 0; j < batchCount; j++) {
      const userId = selectUserForOrder(userCount, config.seed.hotUserPercentage);
      const userRegion = userRegions[userId] || 'US-EAST';
      const order = generateOrder(userId, userRegion);

      batch.push(`(${order.user_id}, '${order.region}', ${order.product_id}, ${order.quantity}, ${order.amount}, '${order.status}', '${order.metadata}')`);
    }

    const { result } = await runQuery(client, `
      INSERT INTO orders (user_id, region, product_id, quantity, amount, status, metadata)
      VALUES ${batch.join(',\n')}
      RETURNING id, user_id
    `);

    result.rows.forEach(row => orderIds.push({ id: row.id, user_id: row.user_id }));

    inserted += batchCount;
    process.stdout.write(`\r  Inserted ${inserted}/${orderCount} orders`);
  }

  console.log(' ✓');
  return orderIds;
}

async function seedOrderItems(client, orderIds) {
  console.log(`\nSeeding order items for ${orderIds.length} orders...`);

  const batchSize = 1000;
  let inserted = 0;

  for (let i = 0; i < orderIds.length; i += batchSize) {
    const batch = [];
    const batchCount = Math.min(batchSize, orderIds.length - i);

    for (let j = 0; j < batchCount; j++) {
      const { id: orderId, user_id: userId } = orderIds[i + j];
      // 1-3 items per order
      const itemCount = Math.floor(Math.random() * 3) + 1;

      for (let k = 0; k < itemCount; k++) {
        const item = require('./utils/data-generator').generateOrderItem(userId, orderId);
        batch.push(`(${item.user_id}, ${item.order_id}, '${item.product_name}', ${item.quantity}, ${item.unit_price})`);
      }
    }

    await runQuery(client, `
      INSERT INTO order_items (user_id, order_id, product_name, quantity, unit_price)
      VALUES ${batch.join(',\n')}
    `);

    inserted += batchCount;
    process.stdout.write(`\r  Processed ${inserted}/${orderIds.length} orders`);
  }

  console.log(' ✓');
}

async function main() {
  console.log('═'.repeat(60));
  console.log('PHASE 1: Setup Database (Regular PostgreSQL)');
  console.log('═'.repeat(60));
  console.log('\nThis creates standard PostgreSQL tables WITHOUT Citus.');
  console.log('Citus will be enabled in Phase 2.\n');

  const client = await getClient();

  try {
    // Create tables
    await runSqlFile(client, 'scripts/setup/00_create_base_table.sql');

    // Seed regions
    await runSqlFile(client, 'scripts/setup/01_initial_seed_data.sql');

    // Seed users
    await seedUsers(client, config.seed.users);

    // Seed orders
    const orderIds = await seedOrders(client, config.seed.orders, config.seed.users);

    // Seed order items
    await seedOrderItems(client, orderIds);

    // Show summary
    console.log('\n' + '─'.repeat(40));
    console.log('Data Summary:');
    console.log('─'.repeat(40));

    const { result: summary } = await runQuery(client, `
      SELECT 'regions' as table_name, COUNT(*) as count FROM regions
      UNION ALL SELECT 'users', COUNT(*) FROM users
      UNION ALL SELECT 'orders', COUNT(*) FROM orders
      UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
    `);
    console.table(summary.rows);

    // Show hot users distribution
    const { result: hotUsers } = await runQuery(client, `
      SELECT user_id, COUNT(*) as order_count
      FROM orders
      GROUP BY user_id
      ORDER BY order_count DESC
      LIMIT 5
    `);
    console.log('\nTop 5 Users by Order Count (Hot Users):');
    console.table(hotUsers.rows);

    // Print shard stats (will show Citus is not enabled)
    await printShardStats(client);

    console.log('\n✓ Phase 1 Complete: Database setup with regular PostgreSQL tables');
    console.log('  Run "npm run phase2" to enable Citus and distribute tables.\n');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
