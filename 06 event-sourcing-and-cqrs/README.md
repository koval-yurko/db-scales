# PostgreSQL Event Sourcing + CQRS — Banking Ledger

Demonstrates **Event Sourcing** combined with **CQRS** in PostgreSQL. All state changes are recorded as immutable events in an append-only log. Current state is derived by replaying events into projections (read models).

## Quick Start

```bash
npm install
docker-compose up -d
npm run all          # Run all 5 phases
```

## Commands

### Run All Phases

| Command | Description |
|---------|-------------|
| `npm run all` | Run all 5 phases sequentially (setup → projections → triggers → snapshots → rebuild) |

### Phase Commands

Each phase command runs its phase logic followed by the query benchmark demo.

| Command | Description |
|---------|-------------|
| `npm run phase1` | **Event Store** — Create tables, seed 1K accounts + 500K events, run direct event store queries |
| `npm run phase2` | **Projections** — Replay all events into 3 projection tables (balances, history, statements), run benchmark |
| `npm run phase3` | **Live Triggers** — Attach INSERT triggers to `account_events` so projections auto-update, run benchmark |
| `npm run phase4` | **Snapshots** — Capture projection state as snapshots, demonstrate rebuild speedup, run benchmark |
| `npm run phase5` | **Temporal + Rebuild** — Run temporal queries, drop and rebuild all projections from events, verify integrity |

### Standalone Commands

These run individual operations without the benchmark demo.

| Command | Description |
|---------|-------------|
| `npm run setup` | Create event store tables and seed 500K events (Phase 1 only, no demo) |
| `npm run build` | Create and populate projection tables from full event replay (Phase 2 only) |
| `npm run live-sync` | Create trigger functions and attach them to `account_events` (Phase 3 only) |
| `npm run snapshots` | Create snapshot table, capture snapshots for all accounts, run rebuild benchmark (Phase 4 only) |
| `npm run rebuild` | Run temporal queries, truncate projections, rebuild from events, verify integrity (Phase 5 only) |
| `npm run temporal` | Run temporal point-in-time balance queries only |
| `npm run demo` | Run query performance comparison: event store vs projections with timing summary table |
| `npm run load` | Continuously generate banking events until stopped. Usage: `npm run load -- [interval_ms] [duration_sec]` |

## Architecture

- **Event Store**: `account_events` — append-only, immutable, single source of truth
- **Projections**: `proj_account_balances`, `proj_transaction_history`, `proj_monthly_statements`
- **Snapshots**: `account_snapshots` — checkpoint state for fast rebuilds
- **Triggers**: Live projection updates on each new event INSERT

See [spec.md](spec.md) for full specification.

## Comparison

SEED_ACCOUNTS=10000
SEED_EVENTS=5000000
Data 2.9 GB

### Phase 1

```
Query 1: Single Account Balance
───────────────────────────────
  Event Store:  $991976.42  (19ms)

Query 2: All Account Balances
─────────────────────────────
  Event Store:  10000 accounts  (22070ms)

Query 3: Monthly Summary (Account 1)
─────────────────────────────────────
  Event Store:  13 months  (18ms)

Query 4: Transaction History (Account 1, last 20)
──────────────────────────────────────────────────
  Event Store:  20 rows  (4ms)

Query 5: Top 10 Accounts by Balance
────────────────────────────────────
  Event Store:  top=1352849.00  (7608ms)

Query 6: Temporal — Balance 6 Months Ago (Account 1)
────────────────────────────────────────────────────
  Event Store:  $476985.23  (6ms)

Query 7: Audit Trail (Account 1)
─────────────────────────────────
  Full audit trail: 2063 events  (7ms)

Query 8: Transfer Chain Tracking
────────────────────────────────
  Transfer chain: 2 events  (9ms)
    ACC-0987 transfer_sent        $3398.35  (TXF-000001)
    ACC-2228 transfer_received    $3398.35  (TXF-000001)
```

### Phase 2

projections: true, triggers: false, snapshots: false

```
  #   Query                         Event Store   Projection  Speedup
  ─── ──────────────────────────── ──────────── ──────────── ────────
  1   Single Account Balance               37ms          0ms   370.0x
  2   All Account Balances              26317ms          7ms  3759.6x
  3   Monthly Summary                      15ms          3ms     5.0x
  4   Transaction History (20)              3ms         71ms     0.0x
  5   Top 10 by Balance                  8257ms          3ms  2752.3x
```