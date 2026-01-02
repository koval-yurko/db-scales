const { Client } = require('pg');
const config = require('./utils/config');

// Helper to generate random data
function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPrice() {
  return (Math.random() * 1000 + 10).toFixed(2);
}

// Sample data for generation
const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const productNames = ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headphones', 'Webcam', 'Microphone', 'Speaker', 'Tablet', 'Phone'];
const productCategories = ['electronics', 'accessories', 'computers', 'audio', 'mobile'];
const orderStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

class ActivitySimulator {
  constructor() {
    this.client = null;
    this.isRunning = false;
    this.intervalId = null;
    this.stats = {
      inserts: { users: 0, products: 0, orders: 0 },
      updates: { users: 0, products: 0, orders: 0 },
      deletes: { users: 0, products: 0, orders: 0 },
      total: 0
    };
  }

  async connect() {
    this.client = new Client({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
    });

    await this.client.connect();
    console.log('Connected to PostgreSQL\n');
  }

  async disconnect() {
    if (this.client) {
      await this.client.end();
      console.log('\nDisconnected from PostgreSQL');
    }
  }

  async insertRandomUser() {
    const username = `${randomElement(firstNames).toLowerCase()}_${randomElement(lastNames).toLowerCase()}_${randomInt(100, 999)}`;
    const email = `${username}@example.com`;

    const result = await this.client.query(
      'INSERT INTO users (username, email) VALUES ($1, $2) RETURNING id',
      [username, email]
    );

    this.stats.inserts.users++;
    this.stats.total++;
    console.log(`[INSERT] User: ${username} (ID: ${result.rows[0].id})`);
  }

  async updateRandomUser() {
    // Get a random user
    const userResult = await this.client.query(
      'SELECT id, username, email FROM users ORDER BY RANDOM() LIMIT 1'
    );

    if (userResult.rows.length === 0) {
      console.log('[UPDATE] No users to update');
      return;
    }

    const user = userResult.rows[0];
    const newEmail = `${user.username}_updated_${randomInt(1, 999)}@example.com`;

    await this.client.query(
      'UPDATE users SET email = $1 WHERE id = $2',
      [newEmail, user.id]
    );

    this.stats.updates.users++;
    this.stats.total++;
    console.log(`[UPDATE] User: ${user.username} (ID: ${user.id}) - new email: ${newEmail}`);
  }

  async insertRandomProduct() {
    const name = `${randomElement(productNames)} ${randomElement(['Pro', 'Plus', 'Max', 'Air', 'Mini'])} ${randomInt(1, 10)}`;
    const price = randomPrice();
    const stock = randomInt(0, 100);

    const result = await this.client.query(
      'INSERT INTO products (name, price, stock) VALUES ($1, $2, $3) RETURNING id',
      [name, price, stock]
    );

    this.stats.inserts.products++;
    this.stats.total++;
    console.log(`[INSERT] Product: ${name} - $${price}, stock: ${stock} (ID: ${result.rows[0].id})`);
  }

  async updateRandomProduct() {
    // Get a random product
    const productResult = await this.client.query(
      'SELECT id, name, price, stock FROM products ORDER BY RANDOM() LIMIT 1'
    );

    if (productResult.rows.length === 0) {
      console.log('[UPDATE] No products to update');
      return;
    }

    const product = productResult.rows[0];

    // Randomly update price or stock
    if (Math.random() < 0.5) {
      const newPrice = randomPrice();
      await this.client.query(
        'UPDATE products SET price = $1 WHERE id = $2',
        [newPrice, product.id]
      );
      console.log(`[UPDATE] Product: ${product.name} (ID: ${product.id}) - new price: $${newPrice} (was $${product.price})`);
    } else {
      const newStock = randomInt(0, 200);
      await this.client.query(
        'UPDATE products SET stock = $1 WHERE id = $2',
        [newStock, product.id]
      );
      console.log(`[UPDATE] Product: ${product.name} (ID: ${product.id}) - new stock: ${newStock} (was ${product.stock})`);
    }

    this.stats.updates.products++;
    this.stats.total++;
  }

  async insertRandomOrder() {
    // Get random user and product
    const userResult = await this.client.query('SELECT id FROM users ORDER BY RANDOM() LIMIT 1');
    const productResult = await this.client.query('SELECT id, price FROM products ORDER BY RANDOM() LIMIT 1');

    if (userResult.rows.length === 0 || productResult.rows.length === 0) {
      console.log('[INSERT] Not enough data to create order');
      return;
    }

    const userId = userResult.rows[0].id;
    const product = productResult.rows[0];
    const quantity = randomInt(1, 5);
    const totalPrice = (parseFloat(product.price) * quantity).toFixed(2);
    const status = randomElement(orderStatuses);

    const result = await this.client.query(
      'INSERT INTO orders (user_id, product_id, quantity, total_price, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, product.id, quantity, totalPrice, status]
    );

    this.stats.inserts.orders++;
    this.stats.total++;
    console.log(`[INSERT] Order: User ${userId} ordered ${quantity}x Product ${product.id} - $${totalPrice}, status: ${status} (ID: ${result.rows[0].id})`);
  }

  async updateRandomOrder() {
    // Get a random order
    const orderResult = await this.client.query(
      'SELECT id, status FROM orders ORDER BY RANDOM() LIMIT 1'
    );

    if (orderResult.rows.length === 0) {
      console.log('[UPDATE] No orders to update');
      return;
    }

    const order = orderResult.rows[0];
    const newStatus = randomElement(orderStatuses);

    await this.client.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      [newStatus, order.id]
    );

    this.stats.updates.orders++;
    this.stats.total++;
    console.log(`[UPDATE] Order: ${order.id} - status changed from '${order.status}' to '${newStatus}'`);
  }

  async deleteRandomOrder() {
    // Delete old cancelled orders (soft simulation of cleanup)
    const orderResult = await this.client.query(
      "SELECT id FROM orders WHERE status = 'cancelled' ORDER BY RANDOM() LIMIT 1"
    );

    if (orderResult.rows.length === 0) {
      console.log('[DELETE] No cancelled orders to delete');
      return;
    }

    const orderId = orderResult.rows[0].id;

    await this.client.query('DELETE FROM orders WHERE id = $1', [orderId]);

    this.stats.deletes.orders++;
    this.stats.total++;
    console.log(`[DELETE] Order: ${orderId} (cancelled order cleanup)`);
  }

  async performRandomActivity() {
    try {
      // Random activity with weighted probabilities
      const random = Math.random();

      if (random < 0.25) {
        // 25% - Insert operations
        const insertType = Math.random();
        if (insertType < 0.3) {
          await this.insertRandomUser();
        } else if (insertType < 0.5) {
          await this.insertRandomProduct();
        } else {
          await this.insertRandomOrder();
        }
      } else if (random < 0.70) {
        // 45% - Update operations
        const updateType = Math.random();
        if (updateType < 0.33) {
          await this.updateRandomUser();
        } else if (updateType < 0.66) {
          await this.updateRandomProduct();
        } else {
          await this.updateRandomOrder();
        }
      } else {
        // 30% - Delete operations (only orders)
        await this.deleteRandomOrder();
      }
    } catch (error) {
      console.error('Error performing activity:', error.message);
    }
  }

  displayStats() {
    console.log('\n========================================');
    console.log('Activity Statistics');
    console.log('========================================');
    console.log('Inserts:');
    console.log(`  Users:    ${this.stats.inserts.users}`);
    console.log(`  Products: ${this.stats.inserts.products}`);
    console.log(`  Orders:   ${this.stats.inserts.orders}`);
    console.log('\nUpdates:');
    console.log(`  Users:    ${this.stats.updates.users}`);
    console.log(`  Products: ${this.stats.updates.products}`);
    console.log(`  Orders:   ${this.stats.updates.orders}`);
    console.log('\nDeletes:');
    console.log(`  Orders:   ${this.stats.deletes.orders}`);
    console.log(`\nTotal operations: ${this.stats.total}`);
    console.log('========================================\n');
  }

  async start(intervalMs = 2000, duration = null) {
    console.log('========================================');
    console.log('Database Activity Simulator');
    console.log('========================================');
    console.log(`Interval: ${intervalMs}ms between operations`);
    if (duration) {
      console.log(`Duration: ${duration}ms (${(duration / 1000).toFixed(0)} seconds)`);
    } else {
      console.log('Duration: Indefinite (press Ctrl+C to stop)');
    }
    console.log('========================================\n');

    this.isRunning = true;

    // Perform first activity immediately
    await this.performRandomActivity();

    // Schedule periodic activities
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.performRandomActivity();
      }
    }, intervalMs);

    // Setup graceful shutdown
    const shutdown = async () => {
      if (!this.isRunning) return;

      console.log('\n\nStopping activity simulator...');
      this.isRunning = false;

      if (this.intervalId) {
        clearInterval(this.intervalId);
      }

      this.displayStats();
      await this.disconnect();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Auto-stop if duration is specified
    if (duration) {
      setTimeout(async () => {
        await shutdown();
      }, duration);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const intervalMs = args[0] ? parseInt(args[0]) : 2000;
  const durationSec = args[1] ? parseInt(args[1]) : null;
  const durationMs = durationSec ? durationSec * 1000 : null;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node simulate-activity.js [interval_ms] [duration_seconds]

Arguments:
  interval_ms       Milliseconds between operations (default: 2000)
  duration_seconds  Total duration in seconds (default: indefinite)

Examples:
  node simulate-activity.js                # Run with defaults (2s interval, indefinite)
  node simulate-activity.js 1000           # Run with 1s interval, indefinite
  node simulate-activity.js 1000 60        # Run with 1s interval for 60 seconds
  node simulate-activity.js 500 30         # Run with 0.5s interval for 30 seconds

Operations:
  - 25% INSERT (users, products, orders)
  - 45% UPDATE (users, products, orders)
  - 30% DELETE (orders only)

Press Ctrl+C to stop at any time.
`);
    process.exit(0);
  }

  const simulator = new ActivitySimulator();

  try {
    await simulator.connect();
    await simulator.start(intervalMs, durationMs);
  } catch (error) {
    console.error('Fatal error:', error.message);
    await simulator.disconnect();
    process.exit(1);
  }
}

main();
