const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5480'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'eav_os_demo',
  },
  opensearch: {
    node: process.env.OPENSEARCH_NODE || 'http://localhost:9280',
    index: process.env.OPENSEARCH_INDEX || 'products',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3080'),
  },
  sync: {
    intervalMs: parseInt(process.env.SYNC_INTERVAL_MS || '1000'),
    batch: parseInt(process.env.SYNC_BATCH || '500'),
    bulkSize: parseInt(process.env.BULK_SIZE || '1000'),
  },
  seed: {
    products: parseInt(process.env.SEED_PRODUCTS || '30000'),
    defaultCategory: process.env.SEED_DEFAULT_CATEGORY || 'laptops',
  },
};

function getConnectionString() {
  const { host, port, user, password, database } = config.db;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

module.exports = { config, getConnectionString };
