const { Client } = require('pg');
const config = require('./config');

class CheckpointManager {
  constructor(client) {
    this.client = client;
    this.slotName = config.replication.slot;
  }

  async loadLastCheckpoint() {
    try {
      const result = await this.client.query(
        'SELECT last_lsn FROM replication_checkpoints WHERE slot_name = $1',
        [this.slotName]
      );

      if (result.rows.length === 0) {
        console.log('No checkpoint found, starting from beginning (0/0)');
        return '0/0';
      }

      const lsn = result.rows[0].last_lsn;
      console.log(`Loaded checkpoint: ${lsn}`);
      return lsn;
    } catch (error) {
      console.error('Error loading checkpoint:', error.message);
      return '0/0';
    }
  }

  async saveCheckpoint(lsn) {
    try {
      await this.client.query(
        `INSERT INTO replication_checkpoints (slot_name, last_lsn, last_processed_at, status)
         VALUES ($1, $2, CURRENT_TIMESTAMP, 'active')
         ON CONFLICT (slot_name)
         DO UPDATE SET
           last_lsn = EXCLUDED.last_lsn,
           last_processed_at = EXCLUDED.last_processed_at,
           status = EXCLUDED.status`,
        [this.slotName, lsn]
      );

      console.log(`Checkpoint saved: ${lsn}`);
      return true;
    } catch (error) {
      console.error('Error saving checkpoint:', error.message);
      return false;
    }
  }

  async getCheckpointStatus() {
    try {
      const result = await this.client.query(
        'SELECT * FROM replication_checkpoints WHERE slot_name = $1',
        [this.slotName]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error('Error getting checkpoint status:', error.message);
      return null;
    }
  }

  lsnToInt(lsn) {
    if (!lsn || lsn === '0/0') return 0;
    const [upper, lower] = lsn.split('/').map(x => parseInt(x, 16));
    return upper * 0x100000000 + lower;
  }

  compareLsn(lsn1, lsn2) {
    const int1 = this.lsnToInt(lsn1);
    const int2 = this.lsnToInt(lsn2);
    if (int1 < int2) return -1;
    if (int1 > int2) return 1;
    return 0;
  }
}

module.exports = CheckpointManager;
