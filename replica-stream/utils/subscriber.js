const { Client } = require('pg');
const LogicalReplication = require('pg-logical-replication');
const config = require('./config');
const CheckpointManager = require('./checkpoint');
const EventProcessor = require('./processor');

class ReplicationSubscriber {
  constructor() {
    this.client = null;
    this.stream = null;
    this.plugin = null;
    this.checkpointManager = null;
    this.eventProcessor = null;
    this.currentLsn = '0/0';
    this.lastCheckpointTime = Date.now();
    this.transactionEvents = [];
    this.isShuttingDown = false;
  }

  async initialize() {
    // Create regular client for checkpoints
    this.client = new Client({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
    });

    await this.client.connect();
    console.log('Connected to PostgreSQL for checkpoint management');

    this.checkpointManager = new CheckpointManager(this.client);
    this.eventProcessor = new EventProcessor();

    // Load last checkpoint
    this.currentLsn = await this.checkpointManager.loadLastCheckpoint();

    // Load test_decoding plugin
    this.plugin = LogicalReplication.LoadPlugin('output/test_decoding');
  }

  async startReplication() {
    try {
      // Create logical replication stream
      this.stream = new LogicalReplication({
        host: config.postgres.host,
        port: config.postgres.port,
        database: config.postgres.database,
        user: config.postgres.user,
        password: config.postgres.password,
      });

      console.log('Connected to PostgreSQL replication stream');
      console.log(`Subscribed to replication slot: ${config.replication.slot}`);
      console.log(`Starting from LSN: ${this.currentLsn}`);
      console.log('---');

      // Handle incoming messages
      this.stream.on('data', async (msg) => {
        await this.handleMessage(msg);
      });

      this.stream.on('error', (error) => {
        console.error('Replication error:', error);
        if (!this.isShuttingDown) {
          setTimeout(() => this.startReplication(), 1000);
        }
      });

      // Start streaming changes
      this.stream.getChanges(
        config.replication.slot,
        this.currentLsn,
        {
          standbyMessageTimeout: 10,
          includeXids: false,
          includeTimestamp: true,
        }
      );

      // Setup graceful shutdown
      this.setupShutdownHandlers();

      console.log('Replication stream active. Waiting for changes...');
    } catch (error) {
      console.error('Error starting replication:', error);
      throw error;
    }
  }

  async handleMessage(msg) {
    try {
      this.currentLsn = msg.lsn;

      // Parse the text log data using test_decoding plugin
      const log = (msg.log || '').toString('utf8');

      if (!log || log.trim() === '') {
        return;
      }

      // test_decoding plugin returns parsed data
      const parsed = this.plugin.parse(log);

      // Handle different message types based on parsed data
      if (parsed.command === 'BEGIN') {
        this.transactionEvents = [];
        console.log(`\n[TRANSACTION BEGIN] LSN: ${msg.lsn}`);
      } else if (parsed.command === 'COMMIT') {
        console.log(`[TRANSACTION COMMIT] LSN: ${msg.lsn}, Events: ${this.transactionEvents.length}`);

        // Process all events in transaction
        let allSuccess = true;
        for (const event of this.transactionEvents) {
          const result = await this.eventProcessor.processEvent(event);
          if (!result.success) {
            allSuccess = false;
            console.error('Event processing failed, transaction will retry on restart');
            break;
          }
        }

        // Only acknowledge and checkpoint if all events processed successfully
        if (allSuccess) {
          await this.checkpointManager.saveCheckpoint(msg.lsn);
          this.lastCheckpointTime = Date.now();
        } else {
          console.log('Skipping checkpoint due to processing errors');
        }

        this.transactionEvents = [];
        this.displayStats();
      } else if (parsed.command === 'INSERT' || parsed.command === 'UPDATE' || parsed.command === 'DELETE') {
        // Collect events within transaction
        // Convert test_decoding format to our event format
        const event = {
          tag: parsed.command.toLowerCase(),
          table: parsed.table,
          new: parsed.new,
          old: parsed.old,
        };
        this.transactionEvents.push(event);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      console.error('Log:', (msg.log || '').toString('utf8'));
    }
  }

  displayStats() {
    const stats = this.eventProcessor.getStats();
    console.log(`\nStats: INSERT=${stats.insert}, UPDATE=${stats.update}, DELETE=${stats.delete}, TOTAL=${stats.total}`);
    console.log(`Current LSN: ${this.currentLsn}`);
    console.log('---');
  }

  setupShutdownHandlers() {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log('\nShutting down gracefully...');

      // Save final checkpoint
      if (this.currentLsn && this.currentLsn !== '0/0') {
        await this.checkpointManager.saveCheckpoint(this.currentLsn);
        console.log('Final checkpoint saved');
      }

      // Close connections
      if (this.stream) {
        this.stream.stop();
        console.log('Replication stream stopped');
      }

      if (this.client) {
        await this.client.end();
        console.log('Database connection closed');
      }

      console.log('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

module.exports = ReplicationSubscriber;
