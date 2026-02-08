const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5460'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'event_sourcing_demo',
  },
  seed: {
    accounts: parseInt(process.env.SEED_ACCOUNTS || '1000'),
    events: parseInt(process.env.SEED_EVENTS || '500000'),
    hotAccountPct: parseInt(process.env.HOT_ACCOUNT_PERCENTAGE || '15'),
    checking: parseInt(process.env.ACCOUNT_TYPES_CHECKING || '700'),
    savings: parseInt(process.env.ACCOUNT_TYPES_SAVINGS || '200'),
    business: parseInt(process.env.ACCOUNT_TYPES_BUSINESS || '100'),
  },
  eventDist: {
    deposit: parseInt(process.env.EVENT_DEPOSIT_PCT || '35'),
    withdrawal: parseInt(process.env.EVENT_WITHDRAWAL_PCT || '25'),
    transfer: parseInt(process.env.EVENT_TRANSFER_PCT || '20'),
    fee: parseInt(process.env.EVENT_FEE_PCT || '10'),
    interest: parseInt(process.env.EVENT_INTEREST_PCT || '5'),
    lifecycle: parseInt(process.env.EVENT_LIFECYCLE_PCT || '5'),
  },
};

function getConnectionString() {
  const { host, port, user, password, database } = config.db;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

module.exports = { config, getConnectionString };
