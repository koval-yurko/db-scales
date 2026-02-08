# Event Sourcing + CQRS — Implementation Plan

## Phase 1: Event Store (Baseline)

### Infrastructure
- [ ] Create `docker-compose.yml` (PostgreSQL 16, port 5460, tuned memory settings)
- [ ] Create `.env` from `.env.example` template
- [ ] Create `package.json` with all scripts and dependencies (`pg`, `dotenv`)
- [ ] `npm install`

### SQL Scripts
- [ ] `scripts/setup/00_create_event_store.sql` — `accounts` table, `account_events` table, all indexes, UNIQUE constraint on `(account_id, sequence_number)`
- [ ] `scripts/setup/01_seed_accounts.sql` — 1,000 accounts (700 checking, 200 savings, 100 business)

### Node.js Scripts
- [ ] `utils/config.js` — env config, PG connection string
- [ ] `utils/sql-runner.js` — execute SQL files with timing
- [ ] `utils/data-generator.js` — generate accounts + 500K events (35% deposits, 25% withdrawals, 20% transfers, 10% fees, 5% interest, 5% lifecycle; hot accounts: 15% accounts → 60% events; transfer pairs with `transfer_id`; per-account sequence numbers; computed `balance_after`)
- [ ] `utils/event-store-stats.js` — event counts, store size, account stats
- [ ] `setup-database.js` — orchestrate: create tables → seed accounts → generate 500K events in batches of 1000 → print summary

### SQL Queries
- [ ] `scripts/queries/40_event_store_queries.sql` — direct balance queries (single account, all accounts, monthly summary)

### Validation
- [ ] Event store has 500K rows
- [ ] Sequence numbers strictly incrementing per account
- [ ] `balance_after` correctly computed for every event
- [ ] Transfer pairs linked by matching `transfer_id`
- [ ] Capture metrics: store size, single-account query time, all-account query time, append throughput

---

## Phase 2: Build Projections

### SQL Scripts
- [ ] `scripts/projections/10_create_projection_tables.sql` — `proj_account_balances`, `proj_transaction_history` (with indexes), `proj_monthly_statements`
- [ ] `scripts/projections/11_build_balances.sql` — replay all events → `proj_account_balances` (current balance, total deposits/withdrawals, tx count, last seq)
- [ ] `scripts/projections/12_build_history.sql` — replay all events → `proj_transaction_history` (enriched: debit/credit split, description, counterparty lookup)
- [ ] `scripts/projections/13_build_statements.sql` — replay all events → `proj_monthly_statements` (opening/closing balance, credits, debits, fees, interest per month)

### Node.js Scripts
- [ ] `projections.js build` command — create projection tables, run replay scripts, print timing

### SQL Queries
- [ ] `scripts/queries/41_projection_queries.sql` — balance lookup, transaction history, monthly statements (all from projections)

### Validation
- [ ] `proj_account_balances` matches event store balances (accuracy check)
- [ ] `proj_transaction_history` has enriched descriptions and counterparties
- [ ] `proj_monthly_statements` has correct opening/closing balances
- [ ] Capture metrics: full replay duration, projection row counts, speedup vs direct queries

---

## Phase 3: Live Projections (Triggers)

### SQL Scripts
- [ ] `scripts/live-sync/20_projection_triggers.sql` — 3 trigger functions: `update_balance_projection()`, `update_history_projection()`, `update_statement_projection()` (all using `ON CONFLICT ... DO UPDATE` for upsert)
- [ ] `scripts/live-sync/21_attach_triggers.sql` — attach all 3 triggers to `account_events` AFTER INSERT

### Node.js Scripts
- [ ] `projections.js live-sync` command — run trigger SQL files, verify triggers are active
- [ ] `load-data.js` — continuous event generator with configurable interval/duration, hot account distribution, graceful SIGINT shutdown

### Validation
- [ ] 3 triggers attached and enabled on `account_events`
- [ ] New events automatically update all 3 projections (same-transaction consistency)
- [ ] Measure write overhead: INSERT with triggers vs without
- [ ] Projection accuracy maintained under continuous load

---

## Phase 4: Snapshots

### SQL Scripts
- [ ] `scripts/snapshots/30_create_snapshot_table.sql` — `account_snapshots` table with PK `(account_id, snapshot_sequence)`
- [ ] `scripts/snapshots/31_take_snapshots.sql` — snapshot all accounts from `proj_account_balances` current state
- [ ] `scripts/snapshots/32_rebuild_from_snapshot.sql` — load snapshot + replay delta events for single account; compare full replay vs snapshot rebuild

### Node.js Scripts
- [ ] `projections.js snapshots` command — create snapshot table, take snapshots, run rebuild comparison

### Validation
- [ ] Snapshots captured for all 1K accounts
- [ ] Snapshot data integrity verified (matches projection state)
- [ ] Capture metrics: snapshot creation time, storage size, full rebuild vs snapshot rebuild time, speedup factor

---

## Phase 5: Temporal Queries & Full Rebuild

### SQL Scripts
- [ ] `scripts/queries/42_temporal_queries.sql` — point-in-time balance (single account), all-account temporal query, snapshot-optimized temporal query
- [ ] `scripts/queries/43_audit_queries.sql` — full audit trail for account, transfer chain tracking

### Node.js Scripts
- [ ] `projections.js rebuild` command — truncate all projections, rebuild from events, verify integrity
- [ ] `projections.js temporal` command — run temporal queries only

### Validation
- [ ] Point-in-time balance query works for any date
- [ ] All-account temporal query works
- [ ] Snapshot-optimized temporal query demonstrated (faster)
- [ ] Full rebuild completes, rebuilt projections match originals
- [ ] Capture metrics: temporal query times, full rebuild time

---

## Phase 6: Demo & Query Benchmark

### Node.js Scripts
- [ ] `demonstrate-queries.js` — detect current phase, run queries against both event store and projections, collect timing, print comparison table (`| Query | Event Store (ms) | Projection (ms) | Speedup |`)

### Demos to Cover
- [ ] Audit trail demo (full event history for an account)
- [ ] Speed comparison (direct vs projection queries)
- [ ] Transfer chain tracking
- [ ] Snapshot rebuild speedup
- [ ] Temporal "time travel" queries
- [ ] New projection rebuild safety net

---

## File Checklist

```
06 event-sourcing-and-cqrs/
├── docker-compose.yml
├── .env.example
├── package.json
├── setup-database.js
├── projections.js
├── demonstrate-queries.js
├── load-data.js
├── utils/
│   ├── config.js
│   ├── sql-runner.js
│   ├── data-generator.js
│   └── event-store-stats.js
├── scripts/
│   ├── setup/
│   │   ├── 00_create_event_store.sql
│   │   └── 01_seed_accounts.sql
│   ├── projections/
│   │   ├── 10_create_projection_tables.sql
│   │   ├── 11_build_balances.sql
│   │   ├── 12_build_history.sql
│   │   └── 13_build_statements.sql
│   ├── live-sync/
│   │   ├── 20_projection_triggers.sql
│   │   └── 21_attach_triggers.sql
│   ├── snapshots/
│   │   ├── 30_create_snapshot_table.sql
│   │   ├── 31_take_snapshots.sql
│   │   └── 32_rebuild_from_snapshot.sql
│   └── queries/
│       ├── 40_event_store_queries.sql
│       ├── 41_projection_queries.sql
│       ├── 42_temporal_queries.sql
│       └── 43_audit_queries.sql
└── README.md
```
