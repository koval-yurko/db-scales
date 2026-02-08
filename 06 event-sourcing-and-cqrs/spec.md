# PostgreSQL Event Sourcing + CQRS — Banking Ledger

## Overview

This project demonstrates **Event Sourcing** combined with **CQRS** in PostgreSQL. Instead of storing current state (traditional CRUD), all state changes are recorded as immutable events in an append-only log. Current state — account balances, transaction history, monthly statements — is **derived** by replaying events into projections (read models).

### Traditional CRUD vs Event Sourcing

| Aspect | Traditional CRUD | Event Sourcing |
|--------|-----------------|----------------|
| State storage | Current state only (overwrite) | Full history of changes (append-only) |
| Audit trail | Requires extra logging | Built-in (events ARE the audit trail) |
| Temporal queries | Not possible without snapshots | Native: replay events to any point in time |
| Schema evolution | Migrations alter existing data | Events are immutable, new projections added |
| Storage cost | Minimal (current state only) | Higher (all events retained forever) |
| Read performance | Direct query on current state | Requires projections (derived read models) |
| Debugging | "What is the state now?" | "What happened and why?" |
| Undo/replay | Not possible | Replay from any point |

### Why Event Sourcing with PostgreSQL?

- PostgreSQL is ACID-compliant — event store integrity guaranteed
- BIGSERIAL + UNIQUE constraints provide event ordering and optimistic concurrency
- Triggers enable live projection updates without external infrastructure
- JSONB metadata stores flexible event payloads
- No need for Kafka, EventStoreDB, or other specialized systems for learning the pattern
- Production-relevant: many financial systems use PostgreSQL-backed event stores

### Demo Objectives

1. **Build an append-only event store** — record all banking transactions as immutable events
2. **Derive projections from events** — replay events to build account balances, transaction history, statements
3. **Live projection updates** — triggers update projections on each new event
4. **Implement snapshots** — checkpoint projection state for fast rebuilds
5. **Temporal queries** — answer "What was the balance on date X?" by replaying events

**Key Learning:** With event sourcing, the event log is the single source of truth. Projections are disposable — they can be rebuilt at any time from events. This gives you complete audit trails, temporal queries, and the ability to add new read models retroactively.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EVENT SOURCING + CQRS ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   COMMAND SIDE (Write)                 QUERY SIDE (Read)                │
│   ════════════════════                 ═════════════════                │
│                                                                         │
│   ┌───────────────────┐               ┌───────────────────────┐         │
│   │                   │    replay     │ proj_account_balances │         │
│   │   account_events  │──────────────►│                       │         │
│   │   (append-only)   │               │ Current balance,      │         │
│   │                   │               │ totals, last tx date  │         │
│   │   ┌─────────────┐ │               └───────────────────────┘         │
│   │   │ event_id    │ │                                                 │
│   │   │ account_id  │ │    replay     ┌───────────────────────┐         │
│   │   │ event_type  │ │──────────────►│ proj_transaction_     │         │
│   │   │ amount      │ │               │ history               │         │
│   │   │ balance_    │ │               │                       │         │
│   │   │   after     │ │               │ Enriched view:        │         │
│   │   │ metadata    │ │               │ debit/credit,         │         │
│   │   │ sequence_   │ │               │ counterparty,         │         │
│   │   │   number    │ │               │ description           │         │
│   │   │ created_at  │ │               └───────────────────────┘         │
│   │   └─────────────┘ │                                                 │
│   │                   │    replay     ┌───────────────────────┐         │
│   │   500K events     │──────────────►│ proj_monthly_         │         │
│   │   1K accounts     │               │ statements            │         │
│   │                   │               │                       │         │
│   │                   │               │ Monthly aggregates:   │         │
│   │                   │               │ opening/closing bal,  │         │
│   │                   │               │ credits, debits       │         │
│   │                   │               └───────────────────────┘         │
│   │                   │   snapshot    ┌───────────────────────┐         │
│   │                   │──────────────►│ account_snapshots     │         │
│   │                   │               │                       │         │
│   │                   │               │ Checkpoint at seq N:  │         │
│   └───────────────────┘               │ full projection state │         │
│                                       └───────────────────────┘         │
│                                                                         │
│   Phase 2: Build projections from full event replay                     │
│   Phase 3: Live triggers update projections on each INSERT              │
│   Phase 4: Snapshots for fast projection rebuilds                       │
│   Phase 5: Temporal queries + full projection rebuild                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Architecture Evolution by Phase:**

| Phase | Event Store | Projections | Snapshots | Key Capability |
|-------|-------------|-------------|-----------|----------------|
| 1 | Created, seeded with 500K events | None | None | Direct event queries (slow) |
| 2 | Unchanged | Built from full replay | None | Fast balance/history queries |
| 3 | Live inserts trigger updates | Auto-updated on each event | None | Real-time projections |
| 4 | Unchanged | Unchanged | Created | Fast projection rebuilds |
| 5 | Unchanged | Rebuildable from events | Used for fast replay | Temporal queries at any point in time |

### Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        EVENT LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. COMMAND: "Deposit $500 into account 42"                            │
│                                                                         │
│   2. VALIDATE:                                                          │
│      - Account 42 exists and is active                                  │
│      - Get current sequence_number for account 42                       │
│                                                                         │
│   3. APPEND EVENT:                                                      │
│      ┌─────────────────────────────────────────┐                        │
│      │ INSERT INTO account_events              │                        │
│      │   account_id: 42                        │                        │
│      │   event_type: 'money_deposited'         │                        │
│      │   amount: 500.00                        │                        │
│      │   balance_after: 1500.00                │                        │
│      │   sequence_number: 47                   │                        │
│      │   metadata: {                           │                        │
│      │     "description": "Salary payment",    │                        │
│      │     "reference": "SAL-2024-001"         │                        │
│      │   }                                     │                        │
│      └─────────────────────────────────────────┘                        │
│                                                                         │
│   4. TRIGGER (Phase 3): Update projections                              │
│      ┌──────────────────┐  ┌───────────────────┐  ┌──────────────────┐  │
│      │ proj_account_    │  │ proj_transaction_ │  │ proj_monthly_    │  │
│      │ balances         │  │ history           │  │ statements       │  │
│      │                  │  │                   │  │                  │  │
│      │ balance: 1500    │  │ credit: 500       │  │ total_credits:   │  │
│      │ deposits: +500   │  │ description:      │  │   +500           │  │
│      │ tx_count: +1     │  │ "Salary payment"  │  │ tx_count: +1     │  │
│      └──────────────────┘  └───────────────────┘  └──────────────────┘  │
│                                                                         │
│   5. QUERY: "What is account 42's balance?"                             │
│      → SELECT current_balance FROM proj_account_balances                │
│        WHERE account_id = 42;                                           │
│      → Result: $1,500.00 (instant lookup)                               │
│                                                                         │
│   6. TEMPORAL QUERY: "What was account 42's balance on Jan 15?"         │
│      → SELECT balance_after FROM account_events                         │
│        WHERE account_id = 42 AND created_at <= '2024-01-15 23:59:59'    │
│        ORDER BY sequence_number DESC LIMIT 1;                           │
│      → Result: $800.00 (point-in-time)                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### 1. Event Store (Append-Only Log)

The event store is the single source of truth. Events are never updated or deleted.

```sql
-- Append a deposit event
INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
VALUES (
    42,
    'money_deposited',
    500.00,
    1500.00,           -- Pre-computed: previous balance + amount
    47,                -- Next sequence for this account
    '{"description": "Salary payment", "reference": "SAL-2024-001"}'
);

-- Events are IMMUTABLE: no UPDATE, no DELETE
-- New sequence_number per account enforces ordering
-- UNIQUE(account_id, sequence_number) prevents duplicate events
```

**Event types in this demo:**
| Event Type | Amount | Description |
|-----------|--------|-------------|
| `account_opened` | Initial deposit | New account creation |
| `account_closed` | NULL | Account closure |
| `money_deposited` | Positive | Salary, cash deposit, incoming transfer |
| `money_withdrawn` | Positive | ATM, purchase, bill payment |
| `transfer_sent` | Positive | Outgoing transfer (debits sender) |
| `transfer_received` | Positive | Incoming transfer (credits receiver) |
| `interest_applied` | Positive | Monthly savings interest |
| `fee_charged` | Positive | Account fees, overdraft fees |

### 2. Sequence Numbers (Optimistic Concurrency)

Each account has its own sequence counter, ensuring strict event ordering and preventing concurrent conflicts.

```sql
-- Get the next sequence number for an account
SELECT COALESCE(MAX(sequence_number), 0) + 1
FROM account_events
WHERE account_id = 42;

-- The UNIQUE(account_id, sequence_number) constraint means:
-- If two concurrent transactions try to append event #47 for account 42,
-- one succeeds and the other fails with a unique violation.
-- The failed transaction retries with sequence #48.
```

### 3. Projections (Derived Read Models)

Projections are read-optimized views derived entirely from events. They are disposable — if corrupted or if the schema changes, just rebuild from events.

```sql
-- Build account balance from events (full replay)
SELECT
    account_id,
    SUM(CASE
        WHEN event_type IN ('money_deposited', 'transfer_received', 'interest_applied')
        THEN amount
        ELSE 0
    END) AS total_deposits,
    SUM(CASE
        WHEN event_type IN ('money_withdrawn', 'transfer_sent', 'fee_charged')
        THEN amount
        ELSE 0
    END) AS total_withdrawals
FROM account_events
WHERE account_id = 42
GROUP BY account_id;

-- Or simply take the latest balance_after (O(1) with index)
SELECT balance_after
FROM account_events
WHERE account_id = 42
ORDER BY sequence_number DESC
LIMIT 1;
```

### 4. Snapshots (Projection Checkpoints)

Snapshots capture the projection state at a specific event sequence, allowing fast rebuilds without replaying the entire event history.

```sql
-- Take a snapshot
INSERT INTO account_snapshots (account_id, snapshot_sequence, balance, total_deposits,
                               total_withdrawals, transaction_count, snapshot_data)
SELECT
    account_id,
    MAX(sequence_number),
    -- Current state derived from latest event
    (SELECT balance_after FROM account_events ae2
     WHERE ae2.account_id = ae.account_id
     ORDER BY sequence_number DESC LIMIT 1),
    SUM(CASE WHEN event_type IN ('money_deposited','transfer_received','interest_applied')
        THEN amount ELSE 0 END),
    SUM(CASE WHEN event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN amount ELSE 0 END),
    COUNT(*),
    json_build_object('rebuilt_at', CURRENT_TIMESTAMP)
FROM account_events ae
WHERE account_id = 42
GROUP BY account_id;

-- Rebuild from snapshot (only replay events AFTER snapshot)
-- Instead of replaying 500 events, replay only 20 since last snapshot
SELECT * FROM account_events
WHERE account_id = 42
  AND sequence_number > (
      SELECT snapshot_sequence FROM account_snapshots
      WHERE account_id = 42
      ORDER BY snapshot_sequence DESC LIMIT 1
  )
ORDER BY sequence_number;
```

### 5. Temporal Queries (Point-in-Time State)

The key superpower of event sourcing: answer "What was the state at any point in time?"

```sql
-- What was account 42's balance on January 15, 2024?
SELECT balance_after
FROM account_events
WHERE account_id = 42
  AND created_at <= '2024-01-15 23:59:59'
ORDER BY sequence_number DESC
LIMIT 1;

-- What were ALL account balances on January 15, 2024?
SELECT DISTINCT ON (account_id)
    account_id,
    balance_after AS balance_at_date,
    created_at AS last_event_before_date
FROM account_events
WHERE created_at <= '2024-01-15 23:59:59'
ORDER BY account_id, sequence_number DESC;

-- How many transactions occurred in January 2024 for account 42?
SELECT
    event_type,
    COUNT(*) AS event_count,
    SUM(amount) AS total_amount
FROM account_events
WHERE account_id = 42
  AND created_at >= '2024-01-01'
  AND created_at < '2024-02-01'
GROUP BY event_type
ORDER BY event_count DESC;
```

### 6. Transfer Pairs (Linked Events)

Transfers between accounts produce two linked events sharing a `transfer_id` in metadata.

```sql
-- Account 42 sends $200 to Account 99
-- Event 1: Debit sender
INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
VALUES (42, 'transfer_sent', 200.00, 1300.00, 48,
    '{"description": "Transfer to Account 99", "counterparty_account_id": 99, "transfer_id": "TXF-001"}');

-- Event 2: Credit receiver
INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
VALUES (99, 'transfer_received', 200.00, 700.00, 12,
    '{"description": "Transfer from Account 42", "counterparty_account_id": 42, "transfer_id": "TXF-001"}');

-- Trace a transfer chain
SELECT
    ae.account_id,
    ae.event_type,
    ae.amount,
    ae.balance_after,
    ae.metadata->>'transfer_id' AS transfer_id,
    ae.metadata->>'counterparty_account_id' AS counterparty
FROM account_events ae
WHERE ae.metadata->>'transfer_id' = 'TXF-001'
ORDER BY ae.created_at;
```

### 7. Event Store Immutability Rules

```sql
-- NEVER update events
-- UPDATE account_events SET amount = 600 WHERE id = 123;  ← FORBIDDEN

-- NEVER delete events
-- DELETE FROM account_events WHERE id = 123;  ← FORBIDDEN

-- To "correct" a mistake, append a compensating event:
INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
VALUES (42, 'money_deposited', 100.00, 1600.00, 49,
    '{"description": "Correction: adjustment for error in event #47", "corrects_event_id": 47}');

-- The event log is a complete, immutable history
-- Corrections are visible in the audit trail
```

---

## File Structure

```
06 event-sourcing-and-cqrs/
├── spec.md                              # This specification
├── README.md                            # Quick start guide
├── todos.md                             # Implementation checklist
├── docker-compose.yml                   # PostgreSQL 16 setup
├── .env.example                         # Environment template
├── package.json                         # Node.js dependencies & scripts
│
├── scripts/
│   ├── setup/
│   │   ├── 00_create_event_store.sql    # accounts + account_events tables + indexes
│   │   └── 01_seed_accounts.sql         # 1,000 account reference data
│   │
│   ├── projections/
│   │   ├── 10_create_projection_tables.sql  # 3 projection tables
│   │   ├── 11_build_balances.sql            # Replay events → proj_account_balances
│   │   ├── 12_build_history.sql             # Replay events → proj_transaction_history
│   │   └── 13_build_statements.sql          # Replay events → proj_monthly_statements
│   │
│   ├── live-sync/
│   │   ├── 20_projection_triggers.sql   # Trigger functions for live projection updates
│   │   └── 21_attach_triggers.sql       # Attach triggers to account_events INSERT
│   │
│   ├── snapshots/
│   │   ├── 30_create_snapshot_table.sql # account_snapshots schema
│   │   ├── 31_take_snapshots.sql        # Capture snapshots for all accounts
│   │   └── 32_rebuild_from_snapshot.sql # Rebuild from snapshot + delta events
│   │
│   └── queries/
│       ├── 40_event_store_queries.sql   # Direct queries on event store (slow)
│       ├── 41_projection_queries.sql    # Queries on projections (fast)
│       ├── 42_temporal_queries.sql      # Point-in-time balance lookups
│       └── 43_audit_queries.sql         # Audit trail + transfer chain tracking
│
├── setup-database.js                    # Phase 1: Event store + seed events
├── projections.js                       # Phase 2-5: Projection orchestrator
├── demonstrate-queries.js               # Query benchmark + comparison
├── load-data.js                         # Continuous event generation
│
└── utils/
    ├── config.js                        # Environment config & connection strings
    ├── sql-runner.js                    # SQL file executor with timing
    ├── data-generator.js                # Account + event generators (banking domain)
    └── event-store-stats.js             # Event counts, projection lag, snapshot info
```

---

## Implementation Phases

### Phase 1: Event Store (Baseline)

Create the event store and seed it with realistic banking activity. Demonstrate that querying the event store directly is possible but slow for common operations like "get current balance."

**Why this matters:** This establishes the problem — event stores are excellent for recording history but poor for direct querying. Getting a current balance requires scanning all events for that account. This motivates projections in Phase 2.

**Tables:**

```sql
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
```

**Seed Data:**
- 1,000 accounts (700 checking, 200 savings, 100 business)
- 500,000 events across 12 months of simulated activity
- Event distribution:
  - 35% money_deposited
  - 25% money_withdrawn
  - 20% transfer_sent + transfer_received (paired)
  - 10% fee_charged
  - 5% interest_applied
  - 5% account_opened / account_closed
- Hot accounts: 15% of accounts generate 60% of events
- Transfer pairs linked by `transfer_id` in metadata
- Sequence numbers strictly incrementing per account

**Direct Event Store Queries (slow):**

```sql
-- Get current balance for account 42 (scan all events)
SELECT balance_after
FROM account_events
WHERE account_id = 42
ORDER BY sequence_number DESC
LIMIT 1;

-- Get balance for ALL accounts (expensive: scan entire event store)
SELECT DISTINCT ON (account_id)
    account_id,
    balance_after AS current_balance
FROM account_events
ORDER BY account_id, sequence_number DESC;

-- Monthly summary for account 42 (aggregation scan)
SELECT
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS tx_count,
    SUM(CASE WHEN event_type IN ('money_deposited','transfer_received','interest_applied')
        THEN amount ELSE 0 END) AS total_credits,
    SUM(CASE WHEN event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN amount ELSE 0 END) AS total_debits
FROM account_events
WHERE account_id = 42
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month;
```

**Metrics to Capture:**
- Event store size (row count, disk size)
- Single-account balance query time
- All-account balance query time
- Append throughput (events/second during seeding)

---

### Phase 2: Build Projections

Replay all 500K events to build three projection tables. These pre-compute the answers to common queries.

**Step 1: Create Projection Tables**

```sql
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
```

**Step 2: Replay Events to Build Projections**

```sql
-- Build proj_account_balances from events
INSERT INTO proj_account_balances
    (account_id, account_number, holder_name, account_type,
     current_balance, total_deposits, total_withdrawals,
     transaction_count, last_transaction_at, last_event_sequence)
SELECT
    ae.account_id,
    a.account_number,
    a.holder_name,
    a.account_type,
    -- Current balance: latest balance_after
    (SELECT balance_after FROM account_events ae2
     WHERE ae2.account_id = ae.account_id
     ORDER BY sequence_number DESC LIMIT 1),
    -- Total deposits
    SUM(CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied')
        THEN ae.amount ELSE 0 END),
    -- Total withdrawals
    SUM(CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN ae.amount ELSE 0 END),
    -- Transaction count
    COUNT(*),
    -- Last transaction
    MAX(ae.created_at),
    -- Last sequence
    MAX(ae.sequence_number)
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
GROUP BY ae.account_id, a.account_number, a.holder_name, a.account_type;

-- Build proj_transaction_history from events
INSERT INTO proj_transaction_history
    (event_id, account_id, account_number, event_type, description,
     debit, credit, balance_after, counterparty, created_at)
SELECT
    ae.event_id,
    ae.account_id,
    a.account_number,
    ae.event_type,
    ae.metadata->>'description',
    CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN ae.amount END AS debit,
    CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied')
        THEN ae.amount END AS credit,
    ae.balance_after,
    CASE WHEN ae.metadata->>'counterparty_account_id' IS NOT NULL
        THEN (SELECT account_number FROM accounts
              WHERE id = (ae.metadata->>'counterparty_account_id')::INTEGER)
    END AS counterparty,
    ae.created_at
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
ORDER BY ae.created_at;

-- Build proj_monthly_statements from events
INSERT INTO proj_monthly_statements
    (account_id, statement_month, opening_balance, closing_balance,
     total_credits, total_debits, transaction_count, fees_charged, interest_earned)
SELECT
    ae.account_id,
    DATE_TRUNC('month', ae.created_at)::DATE AS statement_month,
    -- Opening balance: balance_after of last event BEFORE this month
    (SELECT balance_after FROM account_events prev
     WHERE prev.account_id = ae.account_id
       AND prev.created_at < DATE_TRUNC('month', ae.created_at)
     ORDER BY prev.sequence_number DESC LIMIT 1),
    -- Closing balance: balance_after of last event IN this month
    (SELECT balance_after FROM account_events last_ev
     WHERE last_ev.account_id = ae.account_id
       AND DATE_TRUNC('month', last_ev.created_at) = DATE_TRUNC('month', ae.created_at)
     ORDER BY last_ev.sequence_number DESC LIMIT 1),
    -- Credits
    SUM(CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied')
        THEN ae.amount ELSE 0 END),
    -- Debits
    SUM(CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN ae.amount ELSE 0 END),
    COUNT(*),
    SUM(CASE WHEN ae.event_type = 'fee_charged' THEN ae.amount ELSE 0 END),
    SUM(CASE WHEN ae.event_type = 'interest_applied' THEN ae.amount ELSE 0 END)
FROM account_events ae
GROUP BY ae.account_id, DATE_TRUNC('month', ae.created_at)
ORDER BY ae.account_id, statement_month;
```

**Metrics to Capture:**
- Full replay duration (time to build all 3 projections from 500K events)
- Projection row counts
- Accuracy verification (projection balance vs event store balance)

---

### Phase 3: Live Projections

Add trigger functions on `account_events` INSERT to update projections in real-time. New events automatically update all three projections.

**Trigger Functions:**

```sql
-- Update proj_account_balances on new event
CREATE OR REPLACE FUNCTION update_balance_projection()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO proj_account_balances
        (account_id, account_number, holder_name, account_type,
         current_balance, total_deposits, total_withdrawals,
         transaction_count, last_transaction_at, last_event_sequence)
    SELECT
        NEW.account_id,
        a.account_number,
        a.holder_name,
        a.account_type,
        NEW.balance_after,
        CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied')
            THEN NEW.amount ELSE 0 END,
        CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN NEW.amount ELSE 0 END,
        1,
        NEW.created_at,
        NEW.sequence_number
    FROM accounts a WHERE a.id = NEW.account_id
    ON CONFLICT (account_id) DO UPDATE SET
        current_balance = NEW.balance_after,
        total_deposits = proj_account_balances.total_deposits +
            CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied')
                THEN NEW.amount ELSE 0 END,
        total_withdrawals = proj_account_balances.total_withdrawals +
            CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
                THEN NEW.amount ELSE 0 END,
        transaction_count = proj_account_balances.transaction_count + 1,
        last_transaction_at = NEW.created_at,
        last_event_sequence = NEW.sequence_number,
        last_updated = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update proj_transaction_history on new event
CREATE OR REPLACE FUNCTION update_history_projection()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO proj_transaction_history
        (event_id, account_id, account_number, event_type, description,
         debit, credit, balance_after, counterparty, created_at)
    SELECT
        NEW.event_id,
        NEW.account_id,
        a.account_number,
        NEW.event_type,
        NEW.metadata->>'description',
        CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN NEW.amount END,
        CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied')
            THEN NEW.amount END,
        NEW.balance_after,
        CASE WHEN NEW.metadata->>'counterparty_account_id' IS NOT NULL
            THEN (SELECT account_number FROM accounts
                  WHERE id = (NEW.metadata->>'counterparty_account_id')::INTEGER)
        END,
        NEW.created_at
    FROM accounts a WHERE a.id = NEW.account_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update proj_monthly_statements on new event
CREATE OR REPLACE FUNCTION update_statement_projection()
RETURNS TRIGGER AS $$
DECLARE
    v_month DATE;
BEGIN
    v_month := DATE_TRUNC('month', NEW.created_at)::DATE;

    INSERT INTO proj_monthly_statements
        (account_id, statement_month, opening_balance, closing_balance,
         total_credits, total_debits, transaction_count, fees_charged, interest_earned)
    VALUES (
        NEW.account_id,
        v_month,
        NEW.balance_after - COALESCE(NEW.amount, 0),  -- Approximate opening
        NEW.balance_after,
        CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied')
            THEN NEW.amount ELSE 0 END,
        CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN NEW.amount ELSE 0 END,
        1,
        CASE WHEN NEW.event_type = 'fee_charged' THEN NEW.amount ELSE 0 END,
        CASE WHEN NEW.event_type = 'interest_applied' THEN NEW.amount ELSE 0 END
    )
    ON CONFLICT (account_id, statement_month) DO UPDATE SET
        closing_balance = NEW.balance_after,
        total_credits = proj_monthly_statements.total_credits +
            CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied')
                THEN NEW.amount ELSE 0 END,
        total_debits = proj_monthly_statements.total_debits +
            CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
                THEN NEW.amount ELSE 0 END,
        transaction_count = proj_monthly_statements.transaction_count + 1,
        fees_charged = proj_monthly_statements.fees_charged +
            CASE WHEN NEW.event_type = 'fee_charged' THEN NEW.amount ELSE 0 END,
        interest_earned = proj_monthly_statements.interest_earned +
            CASE WHEN NEW.event_type = 'interest_applied' THEN NEW.amount ELSE 0 END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers
CREATE TRIGGER trg_update_balance
    AFTER INSERT ON account_events
    FOR EACH ROW EXECUTE FUNCTION update_balance_projection();

CREATE TRIGGER trg_update_history
    AFTER INSERT ON account_events
    FOR EACH ROW EXECUTE FUNCTION update_history_projection();

CREATE TRIGGER trg_update_statement
    AFTER INSERT ON account_events
    FOR EACH ROW EXECUTE FUNCTION update_statement_projection();
```

**Metrics to Capture:**
- Write latency: INSERT event with triggers vs without
- Projection freshness: insert event → immediately query projection → should reflect
- Continuous load performance with triggers active

---

### Phase 4: Snapshots

Capture the current projection state as snapshots. Demonstrate fast projection rebuilds by replaying only events since the last snapshot instead of the full history.

**Step 1: Create Snapshot Table**

```sql
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
```

**Step 2: Take Snapshots**

```sql
-- Snapshot all accounts at their current sequence
INSERT INTO account_snapshots
    (account_id, snapshot_sequence, balance, total_deposits,
     total_withdrawals, transaction_count, snapshot_data)
SELECT
    account_id,
    last_event_sequence,
    current_balance,
    total_deposits,
    total_withdrawals,
    transaction_count,
    json_build_object(
        'holder_name', holder_name,
        'account_number', account_number,
        'account_type', account_type,
        'last_transaction_at', last_transaction_at
    )
FROM proj_account_balances;
```

**Step 3: Rebuild from Snapshot (compare vs full replay)**

```sql
-- Full rebuild: replay ALL events (slow for 500K events)
-- Time: ~X seconds

-- Snapshot rebuild: load snapshot + replay only NEW events
-- Step A: Load snapshot state
SELECT * FROM account_snapshots
WHERE account_id = 42
ORDER BY snapshot_sequence DESC LIMIT 1;

-- Step B: Replay only events after snapshot
SELECT * FROM account_events
WHERE account_id = 42
  AND sequence_number > 450  -- snapshot_sequence
ORDER BY sequence_number;

-- Time: ~Y ms (only 50 events vs 500)
-- Speedup: X / Y
```

**Metrics to Capture:**
- Snapshot creation time (for all 1K accounts)
- Snapshot storage size (JSONB overhead)
- Full rebuild time vs snapshot-based rebuild time
- Speedup factor

---

### Phase 5: Temporal Queries & Full Rebuild

Demonstrate the ultimate power of event sourcing: query state at any historical point, and fully rebuild projections from scratch.

**Temporal Queries:**

```sql
-- What was account 42's balance on March 15, 2024?
SELECT balance_after AS balance_at_date
FROM account_events
WHERE account_id = 42
  AND created_at <= '2024-03-15 23:59:59'
ORDER BY sequence_number DESC
LIMIT 1;

-- What were ALL account balances on March 15, 2024?
SELECT DISTINCT ON (account_id)
    account_id,
    balance_after AS balance_at_date
FROM account_events
WHERE created_at <= '2024-03-15 23:59:59'
ORDER BY account_id, sequence_number DESC;

-- Snapshot-optimized temporal query:
-- 1. Find snapshot closest to (but before) target date
-- 2. Replay only events between snapshot and target date
WITH snapshot AS (
    SELECT account_id, snapshot_sequence, balance
    FROM account_snapshots
    WHERE account_id = 42
      AND created_at <= '2024-03-15 23:59:59'
    ORDER BY snapshot_sequence DESC LIMIT 1
),
delta_events AS (
    SELECT *
    FROM account_events
    WHERE account_id = 42
      AND sequence_number > (SELECT snapshot_sequence FROM snapshot)
      AND created_at <= '2024-03-15 23:59:59'
    ORDER BY sequence_number DESC
    LIMIT 1
)
SELECT COALESCE(
    (SELECT balance_after FROM delta_events),
    (SELECT balance FROM snapshot)
) AS balance_at_date;
```

**Full Projection Rebuild:**

```sql
-- Drop all projections
TRUNCATE proj_account_balances;
TRUNCATE proj_transaction_history;
TRUNCATE proj_monthly_statements;

-- Rebuild from scratch (replay all 500K events)
-- Measure time for complete rebuild
-- Compare with: rebuild from snapshots (much faster)
```

**Metrics to Capture:**
- Temporal query time (single account vs all accounts)
- Temporal query with snapshot optimization vs without
- Full projection rebuild time
- Snapshot-based rebuild time
- Integrity check: rebuilt projections match original

---

## Table Designs

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       TABLE RELATIONSHIPS                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   COMMAND SIDE (Source of Truth)                                          │
│   ─────────────────────────────                                          │
│                                                                          │
│   ┌──────────────────┐         ┌──────────────────────────────────┐     │
│   │     accounts     │         │        account_events            │     │
│   ├──────────────────┤         ├──────────────────────────────────┤     │
│   │ id (PK)          │◄────────│ account_id (FK)                  │     │
│   │ account_number   │         │ id (PK, BIGSERIAL)               │     │
│   │ holder_name      │         │ event_id (UUID)                  │     │
│   │ account_type     │         │ event_type                       │     │
│   │ currency         │         │ amount                           │     │
│   │ opened_at        │         │ balance_after                    │     │
│   │ closed_at        │         │ currency                         │     │
│   │ status           │         │ metadata (JSONB)                 │     │
│   └──────────────────┘         │ sequence_number                  │     │
│                                │ created_at                       │     │
│                                │                                  │     │
│                                │ UNIQUE(account_id, seq_number)   │     │
│                                └──────────────────────────────────┘     │
│                                                                          │
│   QUERY SIDE (Derived from Events)                                       │
│   ────────────────────────────────                                       │
│                                                                          │
│   ┌──────────────────────┐  ┌───────────────────────┐                   │
│   │ proj_account_balances│  │ proj_transaction_     │                   │
│   ├──────────────────────┤  │ history               │                   │
│   │ account_id (PK)      │  ├───────────────────────┤                   │
│   │ account_number       │  │ id (PK, BIGSERIAL)    │                   │
│   │ holder_name          │  │ event_id (UUID)       │                   │
│   │ account_type         │  │ account_id            │                   │
│   │ current_balance      │  │ account_number        │                   │
│   │ total_deposits       │  │ event_type            │                   │
│   │ total_withdrawals    │  │ description           │                   │
│   │ transaction_count    │  │ debit / credit        │                   │
│   │ last_transaction_at  │  │ balance_after         │                   │
│   │ last_event_sequence  │  │ counterparty          │                   │
│   │ last_updated         │  │ created_at            │                   │
│   └──────────────────────┘  └───────────────────────┘                   │
│                                                                          │
│   ┌──────────────────────┐  ┌───────────────────────┐                   │
│   │ proj_monthly_        │  │ account_snapshots     │                   │
│   │ statements           │  ├───────────────────────┤                   │
│   ├──────────────────────┤  │ account_id (PK)       │                   │
│   │ account_id (PK)      │  │ snapshot_sequence(PK) │                   │
│   │ statement_month (PK) │  │ balance               │                   │
│   │ opening_balance      │  │ total_deposits        │                   │
│   │ closing_balance      │  │ total_withdrawals     │                   │
│   │ total_credits        │  │ transaction_count     │                   │
│   │ total_debits         │  │ snapshot_data (JSONB) │                   │
│   │ transaction_count    │  │ created_at            │                   │
│   │ fees_charged         │  └───────────────────────┘                   │
│   │ interest_earned      │                                              │
│   └──────────────────────┘                                              │
│                                                                          │
│   Legend: PK = Primary Key   FK = Foreign Key                           │
│           All projections are DERIVED from account_events               │
│           Projections can be dropped and rebuilt at any time             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Event Store Growth Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EVENT STORE DATA MODEL                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Account 42 Event History (example):                                    │
│                                                                          │
│   seq │ event_type        │ amount  │ balance │ metadata               │
│   ────┼───────────────────┼─────────┼─────────┼───────────────────────  │
│     1 │ account_opened    │  500.00 │  500.00 │ {initial deposit}       │
│     2 │ money_deposited   │ 2000.00 │ 2500.00 │ {salary}                │
│     3 │ money_withdrawn   │  100.00 │ 2400.00 │ {ATM}                   │
│     4 │ transfer_sent     │  200.00 │ 2200.00 │ {to acct 99, TXF-001}  │
│     5 │ fee_charged       │   15.00 │ 2185.00 │ {monthly fee}           │
│     6 │ money_deposited   │ 2000.00 │ 4185.00 │ {salary}                │
│     7 │ interest_applied  │    8.37 │ 4193.37 │ {monthly interest}      │
│     8 │ transfer_received │  150.00 │ 4343.37 │ {from acct 77, TXF-002}│
│   ... │ ...               │  ...    │  ...    │ ...                     │
│   500 │ money_deposited   │ 2000.00 │ 8750.00 │ {salary}                │
│                                                                          │
│   ◄───── SNAPSHOT at seq 450 ─────►                                      │
│   Balance: $7200.00                                                      │
│   To rebuild: replay only events 451-500 (50 events)                     │
│   vs full replay: 500 events                                             │
│                                                                          │
│   Temporal query "balance on March 15":                                  │
│   → Find last event before March 15 → seq 342, balance = $5420.00       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## package.json

```json
{
  "name": "postgresql-event-sourcing-demo",
  "version": "1.0.0",
  "description": "PostgreSQL Event Sourcing + CQRS — Banking Ledger with projections and snapshots",
  "scripts": {
    "setup": "node setup-database.js",
    "load": "node load-data.js",
    "demo": "node demonstrate-queries.js",

    "phase1": "npm run setup && npm run demo",
    "phase2": "node projections.js build && npm run demo",
    "phase3": "node projections.js live-sync && npm run demo",
    "phase4": "node projections.js snapshots && npm run demo",
    "phase5": "node projections.js rebuild && npm run demo",

    "build": "node projections.js build",
    "live-sync": "node projections.js live-sync",
    "snapshots": "node projections.js snapshots",
    "rebuild": "node projections.js rebuild",
    "temporal": "node projections.js temporal",

    "all": "npm run phase1 && npm run phase2 && npm run phase3 && npm run phase4 && npm run phase5"
  },
  "keywords": ["postgresql", "event-sourcing", "cqrs", "projections", "snapshots", "temporal"],
  "license": "MIT",
  "dependencies": {
    "pg": "^8.11.3",
    "dotenv": "^16.3.1"
  }
}
```

---

## Node.js Scripts

### setup-database.js

Initializes the event store and seeds banking activity (Phase 1).

```javascript
// Usage: node setup-database.js
// - Connects to PostgreSQL (port 5460)
// - Creates accounts table (reference data)
// - Creates account_events table (event store)
// - Seeds 1,000 accounts (700 checking, 200 savings, 100 business)
// - Generates 500,000 events across 12 months
//   - 35% deposits, 25% withdrawals, 20% transfers, 10% fees, 5% interest, 5% open/close
//   - Hot accounts: 15% generate 60% of events
//   - Transfer pairs linked by transfer_id
//   - Sequence numbers strictly incrementing per account
//   - balance_after computed for each event
// - Batch inserts (1000 events per batch) with progress tracking
// - Displays summary: event counts by type, account count, top accounts by activity
```

### projections.js

Orchestrates projection operations (Phase 2-5).

```javascript
// Usage: node projections.js <command>
// Commands:
//   build      - Phase 2: Create projection tables, replay all events
//   live-sync  - Phase 3: Add triggers for live projection updates
//   snapshots  - Phase 4: Take snapshots, demonstrate rebuild speedup
//   rebuild    - Phase 5: Drop projections, rebuild from events, run temporal queries
//   temporal   - Phase 5: Run temporal queries only (point-in-time balance)
//
// Each command:
// 1. Prints phase header with visual separator (═)
// 2. Checks current state (projections exist? triggers active? snapshots exist?)
// 3. Executes numbered SQL files
// 4. Displays event store statistics
// 5. Prints completion message with next-step hint
```

### demonstrate-queries.js

Runs queries against both event store and projections, with timing comparison.

```javascript
// Usage: node demonstrate-queries.js
// - Detects current phase (no projections / projections / with triggers / with snapshots)
// - Runs balance queries (single account, all accounts, by type)
// - Runs transaction history (recent 50, by type, by date range)
// - Runs analytics (monthly statements, busiest accounts)
// - Runs temporal queries (balance at specific dates)
// - Runs audit queries (full trail for account, transfer chain)
// - Runs rebuild benchmark (full replay vs snapshot-based)
// - Collects all results in queryResults[]
// - Prints summary comparison table:
//   | # | Query | Event Store (ms) | Projection (ms) | Speedup |
```

### load-data.js

Continuously generates banking events.

```javascript
// Usage: node load-data.js [interval_ms] [duration_sec]
// Example: node load-data.js 50 120
// - Generates events with realistic distribution
// - Deposits, withdrawals, transfers (paired), fees, interest
// - Hot account distribution (15% accounts → 60% events)
// - Maintains sequence_number per account
// - Computes balance_after for each event
// - Tracks event rate and total events generated
// - Graceful shutdown on SIGINT
```

---

## Execution Flow

### Quick Start

```bash
# Install dependencies & start database
npm install
docker-compose up -d

# Run all 5 phases automatically
npm run all

# Or run phases individually
npm run phase1    # Event store + seed data
npm run phase2    # Build projections from events
npm run phase3    # Add live projection triggers
npm run phase4    # Take snapshots + rebuild demo
npm run phase5    # Temporal queries + full rebuild
```

### Phase-by-Phase Execution

| Phase | npm Script | What It Does |
|-------|------------|--------------|
| **1** | `npm run phase1` | Create event store, seed 500K events, run direct queries |
| **1** | `npm run load` | (Optional) Generate more events |
| **2** | `npm run phase2` | Create 3 projections, replay all events, run projection queries |
| **3** | `npm run phase3` | Add live triggers, run queries (projections auto-updated) |
| **3** | `npm run load` | (Optional) Generate events → watch projections update |
| **4** | `npm run phase4` | Take snapshots, demonstrate rebuild speedup |
| **5** | `npm run phase5` | Temporal queries, full rebuild from events |

### What to Observe at Each Phase

**Phase 1 (Event Store Only):**
```bash
npm run demo
# Balance query for 1 account: ~5ms (scan one account's events)
# Balance query for ALL accounts: ~500ms+ (scan 500K events)
# Event store has 500K rows
# No projections exist yet
```

**Phase 2 (Projections Built):**
```bash
npm run demo
# Balance query: <1ms (single row lookup from projection)
# Transaction history: <5ms (indexed projection query)
# Full replay took ~X seconds for 500K events
# Projection accuracy verified against event store
```

**Phase 3 (Live Triggers):**
```bash
npm run demo
# New events immediately reflected in projections
# Write overhead visible (INSERT + 3 trigger updates)
# Freshness check: insert event → immediately query → reflected
```

**Phase 4 (Snapshots):**
```bash
npm run demo
# Snapshots captured for all 1K accounts
# Rebuild comparison:
#   Full replay (500K events): ~X seconds
#   Snapshot + delta (50 events avg): ~Y ms
#   Speedup: X/Y
```

**Phase 5 (Temporal + Rebuild):**
```bash
npm run demo
# Temporal: "Balance on March 15" → $X,XXX.XX
# Full rebuild: drop all projections, rebuild from events
# Integrity: rebuilt projections match originals
```

### Cleanup

```bash
# Stop containers (keeps data)
docker-compose down

# Full reset (removes all data)
docker-compose down -v
```

---

## Monitoring Queries

### Event Store Health

```sql
-- Event store size
SELECT
    COUNT(*) AS total_events,
    COUNT(DISTINCT account_id) AS active_accounts,
    pg_size_pretty(pg_total_relation_size('account_events')) AS store_size,
    MIN(created_at) AS first_event,
    MAX(created_at) AS last_event
FROM account_events;

-- Events by type
SELECT
    event_type,
    COUNT(*) AS event_count,
    SUM(amount) AS total_amount,
    ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM account_events) * 100, 1) AS percentage
FROM account_events
GROUP BY event_type
ORDER BY event_count DESC;

-- Event rate (events per day)
SELECT
    DATE(created_at) AS event_date,
    COUNT(*) AS events_per_day
FROM account_events
GROUP BY DATE(created_at)
ORDER BY event_date DESC
LIMIT 30;
```

### Projection Health

```sql
-- Projection lag: check if projections are up-to-date
SELECT
    p.account_id,
    p.last_event_sequence AS projection_seq,
    e.max_seq AS event_store_seq,
    e.max_seq - p.last_event_sequence AS lag_events
FROM proj_account_balances p
JOIN (
    SELECT account_id, MAX(sequence_number) AS max_seq
    FROM account_events
    GROUP BY account_id
) e ON p.account_id = e.account_id
WHERE e.max_seq - p.last_event_sequence > 0
ORDER BY lag_events DESC
LIMIT 10;

-- Projection row counts
SELECT 'proj_account_balances' AS projection, COUNT(*) AS rows FROM proj_account_balances
UNION ALL SELECT 'proj_transaction_history', COUNT(*) FROM proj_transaction_history
UNION ALL SELECT 'proj_monthly_statements', COUNT(*) FROM proj_monthly_statements
UNION ALL SELECT 'account_snapshots', COUNT(*) FROM account_snapshots;
```

### Snapshot Coverage

```sql
-- Snapshot statistics
SELECT
    COUNT(DISTINCT account_id) AS accounts_with_snapshots,
    (SELECT COUNT(*) FROM accounts) AS total_accounts,
    ROUND(COUNT(DISTINCT account_id)::NUMERIC / (SELECT COUNT(*) FROM accounts) * 100, 1) AS coverage_pct,
    AVG(snapshot_sequence) AS avg_snapshot_seq,
    MIN(created_at) AS oldest_snapshot,
    MAX(created_at) AS newest_snapshot,
    pg_size_pretty(pg_total_relation_size('account_snapshots')) AS storage_size
FROM account_snapshots;
```

### Trigger Status

```sql
-- List active triggers on account_events
SELECT
    t.tgname AS trigger_name,
    p.proname AS function_name,
    CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled' END AS status
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'account_events'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;
```

---

## Docker Configuration

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: event-sourcing-demo-db
    ports:
      - "5460:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-event_sourcing_demo}
    volumes:
      - ./data:/var/lib/postgresql/data
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=256MB"
      - "-c"
      - "work_mem=64MB"
      - "-c"
      - "maintenance_work_mem=128MB"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Note:** Increased memory settings (`shared_buffers`, `work_mem`, `maintenance_work_mem`) are important for this module due to the 500K event replay and temporal query workloads.

### .env.example

```bash
# Database connection
POSTGRES_HOST=localhost
POSTGRES_PORT=5460
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=event_sourcing_demo

# Data generation
SEED_ACCOUNTS=1000
SEED_EVENTS=500000
HOT_ACCOUNT_PERCENTAGE=15
ACCOUNT_TYPES_CHECKING=700
ACCOUNT_TYPES_SAVINGS=200
ACCOUNT_TYPES_BUSINESS=100

# Event distribution
EVENT_DEPOSIT_PCT=35
EVENT_WITHDRAWAL_PCT=25
EVENT_TRANSFER_PCT=20
EVENT_FEE_PCT=10
EVENT_INTEREST_PCT=5
EVENT_LIFECYCLE_PCT=5
```

---

## Success Criteria

### Phase 1: Event Store
- [ ] Accounts table created with 1,000 accounts
- [ ] Event store created with proper indexes and unique constraint
- [ ] 500,000 events seeded with correct distribution
- [ ] Transfer pairs linked by matching transfer_id
- [ ] Sequence numbers strictly incrementing per account
- [ ] balance_after correctly computed for every event
- [ ] Direct balance query works (slow but correct)

### Phase 2: Build Projections
- [ ] 3 projection tables created
- [ ] Full event replay completes and duration captured
- [ ] proj_account_balances matches event store balances (accuracy check)
- [ ] proj_transaction_history has enriched descriptions and counterparties
- [ ] proj_monthly_statements has correct opening/closing balances
- [ ] Projection queries 100x+ faster than direct event store queries

### Phase 3: Live Projections
- [ ] 3 triggers attached to account_events INSERT
- [ ] New events automatically update all 3 projections
- [ ] Write overhead measured (INSERT with triggers vs without)
- [ ] Projection accuracy maintained under continuous load
- [ ] No projection lag (same-transaction consistency)

### Phase 4: Snapshots
- [ ] Snapshots captured for all accounts
- [ ] Snapshot storage size measured
- [ ] Rebuild from snapshot demonstrated (single account)
- [ ] Rebuild speedup quantified: full replay vs snapshot + delta
- [ ] Snapshot data integrity verified

### Phase 5: Temporal Queries & Rebuild
- [ ] Point-in-time balance query works for any date
- [ ] All-account temporal query works (slow but correct)
- [ ] Snapshot-optimized temporal query demonstrated
- [ ] Full projection rebuild from events completes
- [ ] Rebuilt projections match originals (integrity check)
- [ ] Rebuild time measured and compared with Phase 2

---

## Educational Demonstrations

### Demo 1: Why Event Sourcing — The Audit Trail

```sql
-- Traditional CRUD: "What is the balance?" → $8,750.00
-- But HOW did we get here? Unknown.

-- Event Sourcing: "What is the balance?" → $8,750.00
-- AND: "Show me every transaction that led to this balance"
SELECT
    sequence_number,
    event_type,
    amount,
    balance_after,
    metadata->>'description' AS description,
    created_at
FROM account_events
WHERE account_id = 42
ORDER BY sequence_number;

-- Complete, immutable history from account opening to now
-- Every dollar accounted for. Every change traceable.
```

### Demo 2: Direct Queries vs Projections — Speed Difference

```
═══════════════════════════════════════════════════════
QUERY PERFORMANCE COMPARISON
═══════════════════════════════════════════════════════

Query: Single Account Balance
─────────────────────────────
  Event Store (scan events):   4.2 ms
  Projection (direct lookup):  0.3 ms  (14x faster)

Query: All Account Balances
───────────────────────────
  Event Store (full scan):   580.0 ms
  Projection (table scan):     8.5 ms  (68x faster)

Query: Monthly Statement
────────────────────────
  Event Store (aggregate):    12.0 ms
  Projection (row lookup):     0.4 ms  (30x faster)

Query: Transaction History (last 50)
────────────────────────────────────
  Event Store (sort + limit):   3.1 ms
  Projection (indexed query):   1.2 ms  (2.5x faster)
```

### Demo 3: Transfer Chain Tracking

```sql
-- Follow the money: trace a transfer between accounts
SELECT
    ae.account_id,
    a.account_number,
    a.holder_name,
    ae.event_type,
    ae.amount,
    ae.balance_after,
    ae.metadata->>'description' AS description
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
WHERE ae.metadata->>'transfer_id' = 'TXF-00042'
ORDER BY ae.created_at;

-- Result:
-- account_id | account_number | event_type        | amount | balance_after
-- 42         | ACC-0042       | transfer_sent     | 200.00 | 2200.00
-- 99         | ACC-0099       | transfer_received | 200.00 |  700.00
```

### Demo 4: Snapshot Rebuild Speedup

```
═══════════════════════════════════════════════════════
PROJECTION REBUILD COMPARISON
═══════════════════════════════════════════════════════

Full Replay (500K events → all projections):
  Duration: 12.5 seconds

Snapshot-Based Rebuild (single account):
  Load snapshot:           0.2 ms
  Replay delta (50 events): 2.1 ms
  Total:                   2.3 ms

Speedup: 5,434x for single-account rebuild
```

### Demo 5: Temporal Queries — Time Travel

```sql
-- Q: "Was account 42 overdrawn at any point in 2024?"
SELECT
    created_at,
    event_type,
    amount,
    balance_after
FROM account_events
WHERE account_id = 42
  AND balance_after < 0
ORDER BY created_at;

-- Q: "What was every account's balance on the last day of each quarter?"
SELECT DISTINCT ON (account_id, quarter)
    account_id,
    DATE_TRUNC('quarter', created_at) AS quarter,
    balance_after AS quarter_end_balance
FROM account_events
WHERE created_at <= DATE_TRUNC('quarter', created_at) + INTERVAL '3 months' - INTERVAL '1 second'
ORDER BY account_id, quarter, sequence_number DESC;
```

### Demo 6: The "Projection Rebuild" Safety Net

```javascript
// Imagine you need a NEW read model: "top 10 accounts by fee revenue"
// With traditional CRUD: you'd need to add logging retroactively — impossible for historical data
// With event sourcing: just create a new projection and replay all events

// 1. Create new projection table
// CREATE TABLE proj_fee_revenue (account_id, total_fees, fee_count, ...);

// 2. Replay all events filtering for fee_charged
// INSERT INTO proj_fee_revenue SELECT ... FROM account_events WHERE event_type = 'fee_charged' ...

// 3. Add trigger for live updates going forward
// Done! Full historical data available from day one.
```

---

## Next Steps

After completing this demo:

1. **Outbox Pattern** — Reliably publish events to external systems (Kafka, Redis) using a transactional outbox table
2. **Event Versioning** — Handle schema evolution when event payloads change over time
3. **Saga Pattern** — Coordinate multi-step business processes across accounts using events
4. **Read Replicas** — Move projections to a separate read-replica database for independent scaling
5. **EventStoreDB** — Compare PostgreSQL-based event store with purpose-built event store database
6. **Process Managers** — Automate reactions to events (overdraft alerts, interest calculations, compliance checks)
