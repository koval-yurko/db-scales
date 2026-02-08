# PostgreSQL Event Sourcing + CQRS — Banking Ledger

Demonstrates **Event Sourcing** combined with **CQRS** in PostgreSQL. All state changes are recorded as immutable events in an append-only log. Current state is derived by replaying events into projections (read models).

## Quick Start

```bash
npm install
docker-compose up -d
npm run all          # Run all 5 phases
```

## Phases

| Phase | Command | Description |
|-------|---------|-------------|
| 1 | `npm run phase1` | Create event store, seed 500K events, run direct queries |
| 2 | `npm run phase2` | Build 3 projections from full event replay |
| 3 | `npm run phase3` | Add live triggers, projections auto-update on INSERT |
| 4 | `npm run phase4` | Take snapshots, demonstrate rebuild speedup |
| 5 | `npm run phase5` | Temporal queries, full projection rebuild |

## Additional Commands

```bash
npm run load            # Generate continuous events (Ctrl+C to stop)
npm run demo            # Run query benchmark comparison
npm run temporal        # Run temporal queries only
docker-compose down -v  # Full reset
```

## Architecture

- **Event Store**: `account_events` — append-only, immutable, single source of truth
- **Projections**: `proj_account_balances`, `proj_transaction_history`, `proj_monthly_statements`
- **Snapshots**: `account_snapshots` — checkpoint state for fast rebuilds
- **Triggers**: Live projection updates on each new event INSERT

See [spec.md](spec.md) for full specification.
