const { Client } = require('pg');
const config = require('./utils/config');
const {
  generateEventLog,
  generateUser,
  generateOrder,
  generateSale
} = require('./utils/data-generator');

class PartitionDataSimulator {
  constructor() {
    this.client = null;
    this.intervalId = null;
    this.startTime = Date.now();
    this.stats = {
      inserts: {
        event_logs: 0,
        users_distributed: 0,
        orders_by_region: 0,
        sales_data: 0
      },
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
    console.log('Connected to database\n');
  }

  async insertEventLog() {
    const data = generateEventLog();
    await this.client.query(
      `INSERT INTO event_logs (event_type, user_id, event_data, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [data.eventType, data.userId, data.eventData, data.ipAddress, data.createdAt]
    );
    this.stats.inserts.event_logs++;
  }

  async insertUser() {
    const data = generateUser();
    await this.client.query(
      `INSERT INTO users_distributed (username, email, country_code, registration_date, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [data.username, data.email, data.countryCode, data.registrationDate, data.status]
    );
    this.stats.inserts.users_distributed++;
  }

  async insertOrder() {
    const data = generateOrder();
    await this.client.query(
      `INSERT INTO orders_by_region (order_number, user_id, product_id, region, order_total, order_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.orderNumber, data.userId, data.productId, data.region, data.orderTotal, data.orderStatus]
    );
    this.stats.inserts.orders_by_region++;
  }

  async insertSale() {
    const data = generateSale();
    await this.client.query(
      `INSERT INTO sales_data (sale_date, product_category, product_id, quantity, unit_price, total_amount, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [data.saleDate, data.productCategory, data.productId, data.quantity, data.unitPrice, data.totalAmount, data.storeId]
    );
    this.stats.inserts.sales_data++;
  }

  async performRandomActivity() {
    try {
      const rand = Math.random();

      if (rand < 0.30) {
        await this.insertEventLog();
      } else if (rand < 0.55) {
        await this.insertUser();
      } else if (rand < 0.80) {
        await this.insertOrder();
      } else {
        await this.insertSale();
      }

      this.stats.total++;

      if (this.stats.total % 10 === 0) {
        this.displayProgress();
      }
    } catch (error) {
      console.error('Error during activity:', error.message);
    }
  }

  displayProgress() {
    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    console.log(`\r[${runtime}s] Total: ${this.stats.total} | Events: ${this.stats.inserts.event_logs} | Users: ${this.stats.inserts.users_distributed} | Orders: ${this.stats.inserts.orders_by_region} | Sales: ${this.stats.inserts.sales_data}`);
  }

  displaySummary() {
    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    console.log('\n========================================');
    console.log('Data Loading Summary');
    console.log('========================================');
    console.log(`Runtime: ${runtime} seconds`);
    console.log(`Total Inserts: ${this.stats.total}`);
    console.log('\nBreakdown by Table:');
    console.log(`  event_logs:         ${this.stats.inserts.event_logs}`);
    console.log(`  users_distributed:  ${this.stats.inserts.users_distributed}`);
    console.log(`  orders_by_region:   ${this.stats.inserts.orders_by_region}`);
    console.log(`  sales_data:         ${this.stats.inserts.sales_data}`);
    console.log('========================================\n');
  }

  async start(intervalMs, durationMs) {
    await this.connect();

    console.log('========================================');
    console.log('Partition Data Simulator Started');
    console.log('========================================');
    console.log(`Interval: ${intervalMs}ms`);
    console.log(`Duration: ${durationMs ? durationMs + 'ms' : 'indefinite'}`);
    console.log('Press Ctrl+C to stop\n');

    this.intervalId = setInterval(async () => {
      await this.performRandomActivity();
    }, intervalMs);

    if (durationMs) {
      setTimeout(async () => {
        await this.stop();
      }, durationMs);
    }
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.displaySummary();

    if (this.client) {
      await this.client.end();
    }

    process.exit(0);
  }
}

// CLI interface
const intervalMs = parseInt(process.argv[2]) || config.simulator.defaultIntervalMs;
const durationSec = parseInt(process.argv[3]) || 0;
const durationMs = durationSec * 1000;

const simulator = new PartitionDataSimulator();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nReceived SIGINT, shutting down gracefully...');
  await simulator.stop();
});

process.on('SIGTERM', async () => {
  console.log('\n\nReceived SIGTERM, shutting down gracefully...');
  await simulator.stop();
});

// Start simulator
simulator.start(intervalMs, durationMs).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
