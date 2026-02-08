-- Phase 1: Create Event Store
-- Accounts registry (reference data) + account_events (append-only event store)

DROP TABLE IF EXISTS account_snapshots CASCADE;
DROP TABLE IF EXISTS proj_monthly_statements CASCADE;
DROP TABLE IF EXISTS proj_transaction_history CASCADE;
DROP TABLE IF EXISTS proj_account_balances CASCADE;
DROP TABLE IF EXISTS account_events CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- Accounts registry (reference data, not event-sourced)
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    account_number VARCHAR(20) NOT NULL UNIQUE,
    holder_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

-- The event store: single source of truth
CREATE TABLE account_events (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL DEFAULT gen_random_uuid(),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    event_type VARCHAR(50) NOT NULL,
    amount DECIMAL(14,2),
    balance_after DECIMAL(14,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    metadata JSONB NOT NULL DEFAULT '{}',
    sequence_number BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (account_id, sequence_number)
);

-- Indexes for common access patterns
CREATE INDEX idx_events_account_id ON account_events (account_id);
CREATE INDEX idx_events_account_seq ON account_events (account_id, sequence_number);
CREATE INDEX idx_events_created_at ON account_events (created_at);
CREATE INDEX idx_events_event_type ON account_events (event_type);
CREATE INDEX idx_events_metadata_transfer ON account_events ((metadata->>'transfer_id'))
    WHERE metadata->>'transfer_id' IS NOT NULL;
