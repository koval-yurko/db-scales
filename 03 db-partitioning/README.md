# PostgreSQL Partitioning Demo

A comprehensive demonstration of PostgreSQL table partitioning strategies, including Range, Hash, List, and Composite partitioning. This project provides hands-on examples of creating, querying, and re-partitioning tables.

## Quick Start

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Setup base tables (no partitioning yet)
npm run setup

# 4. Load some data & run queries on single tables
npm run load
npm run demo

# 5. Apply partitioning
npm run partition

# 6. Load more data & run queries to see partition pruning
npm run load
npm run demo

# 7. (Optional) Revert to single tables and repeat
npm run reset                    # Revert partitioned → single tables
npm run demo                     # Verify single table mode

# 8. (Optional) Explore re-partitioning scenarios
npm run repartition              # Show available scenarios
npm run repartition -- add       # Add new partition
npm run repartition -- cleanup   # Reset re-partitioning changes
```

## Prerequisites

- Docker and Docker Compose
- Node.js 16+
- npm

## Workflow Overview

This demo is designed to show the **before/after** difference of partitioning:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1: npm run setup                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ event_logs  │ │ users_dist. │ │ orders_by.. │ │ sales_data  │       │
│  │ (single)    │ │ (single)    │ │ (single)    │ │ (single)    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                                         │
│  Step 2: npm run partition                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ event_logs  │ │ users_dist. │ │ orders_by.. │ │ sales_data  │       │
│  │ (RANGE)     │ │ (HASH)      │ │ (LIST)      │ │ (COMPOSITE) │       │
│  ├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤       │
│  │ 2024_01     │ │ p0          │ │ north_am.   │ │ Q1_electr.  │       │
│  │ 2024_02     │ │ p1          │ │ europe      │ │ Q1_clothing │       │
│  │ 2024_03     │ │ p2          │ │ asia_pac.   │ │ Q2_electr.  │       │
│  │ default     │ │ p3          │ │ other       │ │ ...         │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Partition Types Explained

### Range Partitioning
**Best for:** Time-series data, sequential IDs, date ranges

```sql
PARTITION BY RANGE (created_at)
```

- Divides data into ranges (e.g., monthly partitions)
- Efficient for date-range queries
- Easy to add new partitions for future data
- Supports partition pruning on range conditions

### Hash Partitioning
**Best for:** Even data distribution, parallel processing

```sql
PARTITION BY HASH (id)
```

- Distributes data evenly across N partitions
- Only prunes on exact value matches
- Does NOT prune on range queries
- Ideal for load balancing across storage

### List Partitioning
**Best for:** Categorical data with known discrete values

```sql
PARTITION BY LIST (region)
```

- Explicit mapping of values to partitions
- Perfect for geographic regions, status codes, categories
- Supports IN clause for multi-partition queries
- Requires default partition for unknown values

### Composite Partitioning
**Best for:** Multi-dimensional query patterns

```sql
PARTITION BY RANGE (sale_date)
SUBPARTITION BY LIST (category)
```

- Combines two partitioning strategies
- Enables pruning on multiple columns
- More complex to manage but powerful for analytics

## Usage

### Step 1: Setup Base Tables

```bash
# Start the database
docker-compose up -d

# Wait for healthy status
docker-compose ps

# Create base tables (single, non-partitioned)
npm run setup
```

### Step 2: Load Data & Test Single Tables

```bash
# Load data continuously (default: 2s interval)
npm run load

# Custom interval (500ms) and duration (60s)
node load-data.js 500 60

# Run query demo - shows queries on SINGLE tables
npm run demo
```

### Step 3: Apply Partitioning

```bash
# Migrate tables to partitioned versions
npm run partition
```

### Step 4: Test Partitioned Tables

```bash
# Load more data
npm run load -- 500 30

# Run query demo - now shows PARTITION PRUNING
npm run demo
```

### Step 5: Re-partitioning Scenarios (Advanced)

After partitioning is applied, you can explore common re-partitioning operations:

```bash
# Show available scenarios
npm run repartition

# Or with node directly
node repartition.js --help
```

**Available scenarios:**

| Scenario | Command | What it does | When to use |
|----------|---------|--------------|-------------|
| `add` | `npm run repartition -- add` | Adds January 2025 partition to event_logs | Need to extend date range for new data |
| `split` | `npm run repartition -- split` | Splits Feb monthly → 4 weekly partitions | Need finer granularity for hot data |
| `detach` | `npm run repartition -- detach` | Archives Jan partition to separate table | Move old data to cold storage |
| `migrate` | `npm run repartition -- migrate` | Creates RANGE version of HASH table | Change partitioning strategy |
| `cleanup` | `npm run repartition -- cleanup` | Resets all re-partitioning changes | Start fresh for testing |

**Recommended order for testing:**
```bash
npm run repartition -- add       # 1. Add new partition
npm run repartition -- split     # 2. Split existing partition
npm run repartition -- detach    # 3. Archive old partition
npm run repartition -- migrate   # 4. Change strategy
npm run repartition -- cleanup   # 5. Reset everything
```

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `setup` | `node setup-base.js` | Create base tables (no partitioning) |
| `partition` | `node setup-partitions.js` | Apply partitioning to existing tables |
| `reset` | `node reset.js` | Revert partitioned tables back to single tables |
| `load` | `node load-data.js` | Continuous data loading |
| `demo` | `node demonstrate-queries.js` | Query demo (auto-detects partitioning) |
| `repartition` | `node repartition.js` | Re-partitioning scenarios |

## Testing Guide

### Quick Test

```bash
docker-compose up -d
npm install
npm run setup
npm run demo           # See: SINGLE TABLE mode
npm run partition
npm run demo           # See: PARTITIONED mode with pruning
```

### Range Partitioning Tests

```bash
# Run in psql or via SQL client
psql -h localhost -p 5438 -U postgres -d partitiondb -f scripts/queries/20_range_queries.sql
```

Verify:
- Single month queries scan only one partition
- Cross-month queries scan multiple partitions
- Queries outside defined ranges hit default partition

### Hash Partitioning Tests

```bash
psql -h localhost -p 5438 -U postgres -d partitiondb -f scripts/queries/21_hash_queries.sql
```

Verify:
- Exact ID lookups scan single partition
- Range queries scan ALL partitions
- Even distribution across partitions

### List Partitioning Tests

```bash
psql -h localhost -p 5438 -U postgres -d partitiondb -f scripts/queries/22_list_queries.sql
```

Verify:
- Single region queries scan one partition
- IN clause queries scan only specified partitions
- Unknown regions hit "other" partition

### Composite Partitioning Tests

```bash
psql -h localhost -p 5438 -U postgres -d partitiondb -f scripts/queries/23_composite_queries.sql
```

Verify:
- Quarter + category queries hit single leaf partition
- Quarter-only queries hit all categories in that quarter
- Category-only queries hit that category across all quarters

### Re-partitioning Scenario Tests

```bash
# Test each scenario in order
node repartition.js add      # Should add event_logs_2024_04
node repartition.js split    # Should create weekly sub-partitions
node repartition.js detach   # Should archive January data
node repartition.js migrate  # Should create users_by_date table
node repartition.js cleanup  # Should restore original state
```

### Load Testing

```bash
# High-frequency inserts (100ms interval, 5 minutes)
node load-data.js 100 300

# Monitor partition sizes
psql -h localhost -p 5438 -U postgres -d partitiondb -c "
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size('public.' || tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'event_logs%'
ORDER BY tablename;
"
```

### Manual SQL Tests

Connect to database:
```bash
psql -h localhost -p 5438 -U postgres -d partitiondb
```

Check partition pruning:
```sql
EXPLAIN (ANALYZE, COSTS OFF)
SELECT * FROM event_logs
WHERE created_at >= '2024-02-01' AND created_at < '2024-03-01';
```

View partition hierarchy:
```sql
SELECT
    parent.relname AS parent,
    child.relname AS child,
    pg_get_expr(child.relpartbound, child.oid) AS bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'event_logs'
ORDER BY child.relname;
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | localhost | Database host |
| `POSTGRES_PORT` | 5438 | Database port |
| `POSTGRES_DB` | partitiondb | Database name |
| `POSTGRES_USER` | postgres | Database user |
| `POSTGRES_PASSWORD` | postgres | Database password |
| `SIMULATOR_INTERVAL_MS` | 2000 | Data load interval |

Create `.env` from template:
```bash
cp .env.example .env
```

## File Structure

```
03 db-partitioning/
├── docker-compose.yml          # PostgreSQL container
├── package.json                # Node.js dependencies
├── .env.example                # Environment template
├── .gitignore
│
├── setup-base.js               # Step 1: Create base tables
├── setup-partitions.js         # Step 2: Apply partitioning
├── load-data.js                # Continuous data simulator
├── demonstrate-queries.js      # Query demo (auto-detects mode)
├── repartition.js              # Re-partitioning orchestrator
│
├── utils/
│   ├── config.js               # Configuration loader
│   ├── data-generator.js       # Random data generation
│   ├── sql-runner.js           # SQL file executor
│   ├── partition-stats.js      # Partition statistics
│   └── query-executor.js       # Query with timing/explain
│
└── scripts/
    ├── 00_setup_base_tables.sql     # Non-partitioned tables
    ├── 00_initial_seed_data.sql     # Seed data
    ├── 01_range_partitions.sql      # Range partitioning
    ├── 02_hash_partitions.sql       # Hash partitioning
    ├── 03_list_partitions.sql       # List partitioning
    ├── 04_composite_partitions.sql  # Composite partitioning
    │
    ├── queries/
    │   ├── 20_range_queries.sql     # Range query examples
    │   ├── 21_hash_queries.sql      # Hash query examples
    │   ├── 22_list_queries.sql      # List query examples
    │   └── 23_composite_queries.sql # Composite query examples
    │
    └── repartition/
        ├── 10_add_new_partition.sql    # Add partition
        ├── 11_split_partition.sql      # Split partition
        ├── 12_detach_archive.sql       # Detach & archive
        ├── 13_migrate_strategy.sql     # Change strategy
        └── 14_cleanup_repartition.sql  # Reset state
```

## Troubleshooting

### Database Connection Issues

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs postgres

# Restart container
docker-compose restart
```

### Permission Errors

```bash
# Fix data directory permissions
sudo chown -R $(whoami) ./data
```

### Partition Not Pruning

- Ensure WHERE clause uses partition key column
- Check data types match (timestamp vs date)
- Use `EXPLAIN (ANALYZE)` to verify pruning

### Data Type Mismatch

```sql
-- Wrong: string comparison on timestamp
WHERE created_at >= '2024-01-01'

-- Correct: explicit timestamp
WHERE created_at >= '2024-01-01'::timestamp
```

## Resources

- [PostgreSQL Partitioning Documentation](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Partition Pruning](https://www.postgresql.org/docs/current/ddl-partitioning.html#DDL-PARTITION-PRUNING)
- [EXPLAIN ANALYZE](https://www.postgresql.org/docs/current/sql-explain.html)
- [pg_partman Extension](https://github.com/pgpartman/pg_partman)
