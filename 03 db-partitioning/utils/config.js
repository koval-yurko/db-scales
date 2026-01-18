require('dotenv').config();

const config = {
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5438,
    database: process.env.POSTGRES_DB || 'partitiondb',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  simulator: {
    defaultIntervalMs: parseInt(process.env.SIMULATOR_INTERVAL_MS) || 2000,
  }
};

function validateConfig() {
  const required = [
    'postgres.host',
    'postgres.port',
    'postgres.database',
    'postgres.user',
    'postgres.password'
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
