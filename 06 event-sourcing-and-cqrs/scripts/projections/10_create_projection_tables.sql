-- Phase 2: Create Projection Tables
-- These are read-optimized views derived entirely from events

DROP TABLE IF EXISTS proj_monthly_statements CASCADE;
DROP TABLE IF EXISTS proj_transaction_history CASCADE;
DROP TABLE IF EXISTS proj_account_balances CASCADE;

-- Projection 1: Current account balances
CREATE TABLE proj_account_balances (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
    account_number VARCHAR(20),
    holder_name VARCHAR(100),
    account_type VARCHAR(20),
    current_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_deposits DECIMAL(14,2) DEFAULT 0,
    total_withdrawals DECIMAL(14,2) DEFAULT 0,
    transaction_count INTEGER DEFAULT 0,
    last_transaction_at TIMESTAMP,
    last_event_sequence BIGINT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projection 2: Enriched transaction history
CREATE TABLE proj_transaction_history (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL,
    account_id INTEGER NOT NULL,
    account_number VARCHAR(20),
    event_type VARCHAR(50) NOT NULL,
    description TEXT,
    debit DECIMAL(14,2),
    credit DECIMAL(14,2),
    balance_after DECIMAL(14,2),
    counterparty VARCHAR(100),
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_proj_history_account ON proj_transaction_history (account_id);
CREATE INDEX idx_proj_history_created ON proj_transaction_history (created_at);

-- Projection 3: Monthly statements
CREATE TABLE proj_monthly_statements (
    account_id INTEGER NOT NULL,
    statement_month DATE NOT NULL,
    opening_balance DECIMAL(14,2),
    closing_balance DECIMAL(14,2),
    total_credits DECIMAL(14,2) DEFAULT 0,
    total_debits DECIMAL(14,2) DEFAULT 0,
    transaction_count INTEGER DEFAULT 0,
    fees_charged DECIMAL(14,2) DEFAULT 0,
    interest_earned DECIMAL(14,2) DEFAULT 0,
    PRIMARY KEY (account_id, statement_month)
);
