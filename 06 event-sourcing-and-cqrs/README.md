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
