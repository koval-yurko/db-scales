const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5470'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'eav_demo',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3070'),
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
