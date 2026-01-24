require('dotenv').config();

const config = {
  coordinator: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5440'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'sharding_demo',
  },
  workers: {
    worker1: {
      host: process.env.WORKER1_HOST || 'localhost',
      port: parseInt(process.env.WORKER1_PORT || '5441'),
    },
    worker2: {
      host: process.env.WORKER2_HOST || 'localhost',
      port: parseInt(process.env.WORKER2_PORT || '5442'),
    },
    worker3: {
      host: process.env.WORKER3_HOST || 'localhost',
      port: parseInt(process.env.WORKER3_PORT || '5443'),
    },
  },
  // Internal Docker network hostnames (used by coordinator to reach workers)
  workerNodes: {
    worker1: { host: 'worker1', port: 5432 },
    worker2: { host: 'worker2', port: 5432 },
    worker3: { host: 'worker3', port: 5432 },
  },
  seed: {
    users: parseInt(process.env.SEED_USERS || '1000'),
    orders: parseInt(process.env.SEED_ORDERS || '10000'),
    hotUserPercentage: parseInt(process.env.HOT_USER_PERCENTAGE || '20'),
  },
};

function getCoordinatorConnectionString() {
  const { host, port, user, password, database } = config.coordinator;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

function getWorkerConnectionString(workerName) {
  const worker = config.workers[workerName];
  if (!worker) throw new Error(`Unknown worker: ${workerName}`);
  const { user, password, database } = config.coordinator;
  return `postgresql://${user}:${password}@${worker.host}:${worker.port}/${database}`;
}

module.exports = {
  config,
  getCoordinatorConnectionString,
  getWorkerConnectionString,
};
