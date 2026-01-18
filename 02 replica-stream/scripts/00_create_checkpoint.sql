-- Create checkpoint tracking table
-- This table tracks the last processed LSN for replication resumption
-- Can be created before PostgreSQL restart (doesn't require wal_level=logical)

CREATE TABLE IF NOT EXISTS replication_checkpoints (
    slot_name VARCHAR(64) PRIMARY KEY,
    last_lsn PG_LSN NOT NULL,
    last_processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

-- Initialize checkpoint for the replication slot
INSERT INTO replication_checkpoints (slot_name, last_lsn, status)
VALUES ('my_slot', '0/0', 'initialized')
ON CONFLICT (slot_name) DO NOTHING;

SELECT 'Checkpoint tracking table created' AS status;
