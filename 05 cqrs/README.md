# PostgreSQL CQRS — E-Commerce Order Analytics

Demonstrates **Command Query Responsibility Segregation** in PostgreSQL using three sync strategies: Materialized Views, Triggers, and LISTEN/NOTIFY.

## The Problem

Analytics queries on normalized tables require expensive JOINs that get slower as data grows. CQRS separates the write model (normalized OLTP) from the read model (denormalized, pre-computed) so reads stay fast regardless of data volume.

## Architecture

```
WRITE PATH (normalized)              READ PATH (denormalized)
┌──────────────┐                     ┌────────────────────────┐
│    users     │                     │ read_revenue_by_region │
│  (5K rows)   │                     └────────────────────────┘
├──────────────┤       SYNC          ┌────────────────────────┐
│   products   │    ══════════►      │   read_top_products    │
│  (100 rows)  │                     └────────────────────────┘
├──────────────┤                     ┌────────────────────────┐
│   orders     │                     │  read_user_spending    │
│ (100K rows)  │                     └────────────────────────┘
├──────────────┤                     ┌────────────────────────┐
│ order_items  │                     │   read_daily_stats     │
│ (300K rows)  │                     └────────────────────────┘
└──────────────┘
```

## Sync Strategies

| Phase | Strategy | Read Speed | Write Overhead | Consistency |
|-------|----------|-----------|----------------|-------------|
| 1 | Baseline (JOINs) | 19–60ms | None | Perfect |
| 2 | Materialized Views | <1ms | None (refresh is O(n)) | Stale until refresh |
| 3 | Triggers | <1ms | ~1.3x slower writes | Always consistent |
| 4 | LISTEN/NOTIFY | <1ms | Minimal (just NOTIFY) | Eventually consistent |

## Quick Start

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
npm install

# Run all 4 phases automatically
npm run all
```

## Phase-by-Phase

### Phase 1: Baseline

Creates normalized tables, seeds 5K users, 100K orders, ~300K order items. Runs analytics via JOINs.

```bash
npm run phase1
```

### Phase 2: Materialized Views

Pre-computes analytics into materialized views. Reads become instant but data is stale between refreshes.

```bash
npm run phase2
npm run refresh   # manually refresh views after writes
```

### Phase 3: Trigger-Based Sync

Replaces mat views with real denormalized tables updated synchronously via triggers on every write.

```bash
npm run phase3
```

### Phase 4: LISTEN/NOTIFY

Replaces heavy triggers with lightweight `pg_notify()`. A background worker batches notifications and updates read tables asynchronously.

```bash
npm run phase4

# In a separate terminal — start the sync worker
npm run worker
```

## npm Scripts

All available scripts are defined in `package.json`:

| Script | Command | Description |
|--------|---------|-------------|
| `setup` | `npm run setup` | Create tables and seed data (Phase 1) |
| `demo` | `npm run demo` | Run query benchmark against current strategy |
| `load` | `npm run load` | Generate continuous write traffic |
| `worker` | `npm run worker` | Start LISTEN/NOTIFY sync worker (Phase 4) |
| `phase1` | `npm run phase1` | Setup + demo (baseline) |
| `phase2` | `npm run phase2` | Create materialized views + demo |
| `phase3` | `npm run phase3` | Switch to triggers + demo |
| `phase4` | `npm run phase4` | Switch to NOTIFY + demo |
| `mat-views` | `npm run mat-views` | Create materialized views only |
| `triggers` | `npm run triggers` | Switch to trigger sync only |
| `notify` | `npm run notify` | Switch to NOTIFY sync only |
| `refresh` | `npm run refresh` | Refresh all materialized views |
| `all` | `npm run all` | Run all 4 phases sequentially |

Scripts with extra arguments:

```bash
npm run load -- 50 120    # Custom: 50ms interval, 120s duration
npm run worker -- 200     # Custom batch interval (200ms)
```

## What to Observe

**Phase 1** — EXPLAIN shows Hash Joins and Seq Scans across multiple tables. Dashboard queries take 19–60ms.

**Phase 2** — Same queries now scan a single pre-computed view in <1ms. Insert a row and query immediately — the view is stale. Run `npm run refresh` to update.

**Phase 3** — Reads are equally fast. Writes are ~1.3x slower due to trigger overhead. Insert and query immediately — the change is reflected instantly (same transaction).

**Phase 4** — Writes return to baseline speed (NOTIFY is cheap). Start the worker in another terminal, then run `npm run load` — watch the worker log batch flushes. There's a small consistency lag equal to the batch interval.

## File Structure

```
05 cqrs/
├── docker-compose.yml          # PostgreSQL 16
├── package.json                # npm scripts for each phase
├── setup-database.js           # Phase 1: create tables, seed data
├── sync-models.js              # Phase 2–4: switch sync strategy
├── demonstrate-queries.js      # Benchmark queries + comparison table
├── load-data.js                # Continuous order generator
├── sync-worker.js              # Phase 4: LISTEN/NOTIFY batch worker
├── scripts/
│   ├── setup/                  # Table creation + product seeds
│   ├── materialized-views/     # Mat view creation + refresh
│   ├── triggers/               # Read tables + sync triggers + backfill
│   ├── notify/                 # NOTIFY triggers
│   └── queries/                # Baseline + read model query templates
└── utils/
    ├── config.js               # DB connection config
    ├── sql-runner.js            # SQL file executor with timing
    ├── data-generator.js        # Pareto-distributed data generation
    └── cqrs-stats.js           # Strategy detection + freshness monitoring
```

## Cleanup

```bash
docker compose down      # stop (keeps data)
docker compose down -v   # full reset (removes all data)
```


## Comparison

### Phase 1
Simple JOINs

Read Performance:
─────────────────────────────────────────
```
┌─────────┬─────────────────────────┬───────────────┬─────────────────┬─────────┐
│ (index) │ Query                   │ Baseline (ms) │ Read Model (ms) │ Speedup │
├─────────┼─────────────────────────┼───────────────┼─────────────────┼─────────┤
│ 0       │ 'Revenue by Region'     │ 1440          │ 'N/A'           │ 'N/A'   │
│ 1       │ 'Top 10 Products'       │ 11391         │ 'N/A'           │ 'N/A'   │
│ 2       │ 'Top 20 Spenders'       │ 16612         │ 'N/A'           │ 'N/A'   │
│ 3       │ 'Daily Stats (30 days)' │ 3749          │ 'N/A'           │ 'N/A'   │
└─────────┴─────────────────────────┴───────────────┴─────────────────┴─────────┘
```
Write Performance:
─────────────────────────────────────────

1000 INSERTs: 306ms total, 0.31ms avg


### Phase 2 - Materialized views

REFRESH on demand

Read Performance:
─────────────────────────────────────────
```
┌─────────┬─────────────────────────┬───────────────┬─────────────────┬───────────┐
│ (index) │ Query                   │ Baseline (ms) │ Read Model (ms) │ Speedup   │
├─────────┼─────────────────────────┼───────────────┼─────────────────┼───────────┤
│ 0       │ 'Revenue by Region'     │ 839           │ 9               │ '93.2x'   │
│ 1       │ 'Top 10 Products'       │ 11397         │ 4               │ '2849.3x' │
│ 2       │ 'Top 20 Spenders'       │ 16106         │ 57              │ '282.6x'  │
│ 3       │ 'Daily Stats (30 days)' │ 3889          │ 2               │ '1944.5x' │
└─────────┴─────────────────────────┴───────────────┴─────────────────┴───────────┘
```
Write Performance:
─────────────────────────────────────────

1000 INSERTs: 255ms total, 0.26ms avg

### Phase 3 - Triggers

sync on each write, always consistent

Read Performance:
─────────────────────────────────────────
```
┌─────────┬─────────────────────────┬───────────────┬─────────────────┬───────────┐
│ (index) │ Query                   │ Baseline (ms) │ Read Model (ms) │ Speedup   │
├─────────┼─────────────────────────┼───────────────┼─────────────────┼───────────┤
│ 0       │ 'Revenue by Region'     │ 1439          │ 4               │ '359.8x'  │
│ 1       │ 'Top 10 Products'       │ 11266         │ 3               │ '3755.3x' │
│ 2       │ 'Top 20 Spenders'       │ 16373         │ 53              │ '308.9x'  │
│ 3       │ 'Daily Stats (30 days)' │ 3532          │ 1               │ '3532.0x' │
└─────────┴─────────────────────────┴───────────────┴─────────────────┴───────────┘
```
Write Performance:
─────────────────────────────────────────

1000 INSERTs: 339ms total, 0.34ms avg

### Phase 4 - Notify

async worker, eventual consistency

Read Performance:
─────────────────────────────────────────
```
┌─────────┬─────────────────────────┬───────────────┬─────────────────┬───────────┐
│ (index) │ Query                   │ Baseline (ms) │ Read Model (ms) │ Speedup   │
├─────────┼─────────────────────────┼───────────────┼─────────────────┼───────────┤
│ 0       │ 'Revenue by Region'     │ 1060          │ 1               │ '1060.0x' │
│ 1       │ 'Top 10 Products'       │ 11380         │ 0               │ '∞x'      │
│ 2       │ 'Top 20 Spenders'       │ 14533         │ 104             │ '139.7x'  │
│ 3       │ 'Daily Stats (30 days)' │ 3534          │ 2               │ '1767.0x' │
└─────────┴─────────────────────────┴───────────────┴─────────────────┴───────────┘
```
Write Performance:
─────────────────────────────────────────

1000 INSERTs: 321ms total, 0.32ms avg