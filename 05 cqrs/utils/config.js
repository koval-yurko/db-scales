require('dotenv').config();

const config = {
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5450'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'cqrs_demo',
  },
  seed: {
    users: parseInt(process.env.SEED_USERS || '5000'),
    orders: parseInt(process.env.SEED_ORDERS || '100000'),
    hotUserPercentage: parseInt(process.env.HOT_USER_PERCENTAGE || '20'),
  },
  worker: {
    batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || '500'),
  },
};

function getConnectionString() {
  const { host, port, user, password, database } = config.db;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

module.exports = { config, getConnectionString };
