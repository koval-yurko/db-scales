-- Phase 4: Create snapshot table

DROP TABLE IF EXISTS account_snapshots CASCADE;

CREATE TABLE account_snapshots (
    account_id INTEGER NOT NULL,
    snapshot_sequence BIGINT NOT NULL,
    balance DECIMAL(14,2) NOT NULL,
    total_deposits DECIMAL(14,2) NOT NULL,
    total_withdrawals DECIMAL(14,2) NOT NULL,
    transaction_count INTEGER NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, snapshot_sequence)
);
