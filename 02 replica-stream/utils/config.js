require('dotenv').config();

const config = {
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'testdb',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  replication: {
    slot: process.env.REPLICATION_SLOT || 'my_slot',
    publication: process.env.PUBLICATION_NAME || 'my_pub',
  },
  checkpoint: {
    intervalMs: parseInt(process.env.CHECKPOINT_INTERVAL_MS) || 5000,
  },
};

function validateConfig() {
  const required = [
    'postgres.host',
    'postgres.port',
    'postgres.database',
    'postgres.user',
    'postgres.password',
    'replication.slot',
    'replication.publication',
  ];

  const missing = [];
  for (const key of required) {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value[k];
      if (value === undefined || value === null || value === '') {
        missing.push(key);
        break;
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return true;
}

validateConfig();

module.exports = config;
