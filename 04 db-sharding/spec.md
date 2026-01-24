# PostgreSQL Sharding with Citus

## Overview

This project demonstrates **horizontal sharding** in PostgreSQL using the **Citus extension**. Unlike partitioning (which splits data across tables on a single server), sharding distributes data across multiple physical database servers (nodes).

### Sharding vs Partitioning

| Aspect | Partitioning | Sharding |
|--------|-------------|----------|
| Data location | Single server, multiple tables | Multiple servers |
| Scalability | Vertical (bigger server) | Horizontal (more servers) |
| Query routing | Automatic by PostgreSQL | Requires coordinator |
| Use case | Large tables, archiving | Massive scale, multi-tenant |

### Why Citus?

- Production-ready PostgreSQL extension (used by Microsoft Azure)
- Transparent distributed query execution
- Built-in resharding and rebalancing tools
- Supports distributed transactions
- Minimal application code changes

### Demo Objectives

1. **Start with a regular PostgreSQL table** - standard tables, indexes, seed data (Citus NOT enabled yet)
2. **Enable Citus and distribute** - `CREATE EXTENSION citus`, then convert existing tables to distributed
3. **Resharding operations** - add nodes, rebalance shards across workers
4. **Undistribute** - convert back to regular table (remove sharding)

**Key Learning:** Citus can be added to an existing PostgreSQL database with existing data. You don't need to design for sharding from day one.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Network                              │
│                                                                  │
│   ┌──────────────────────┐                                       │
│   │     Coordinator      │  ← Application connects here          │
│   │     (Port 5440)      │  ← Routes queries to workers          │
│   │                      │  ← Stores metadata (pg_dist_*)        │
│   └──────────┬───────────┘                                       │
│              │                                                   │
│        ┌─────┴─────┐                                             │
│        │           │                                             │
│   ┌────▼────┐ ┌────▼────┐ ┌─────────┐                            │
│   │ Worker1 │ │ Worker2 │ │ Worker3 │  ← Added during resharding │
│   │  :5441  │ │  :5442  │ │  :5443  │                            │
│   │         │ │         │ │         │                            │
│   │ Shards  │ │ Shards  │ │ Shards  │  ← Data distributed here   │
│   │ 1,3,5.. │ │ 2,4,6.. │ │ (idle)  │  ← Not registered yet      │
│   └─────────┘ └─────────┘ └─────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Architecture Evolution by Phase:**

| Phase | Coordinator | Workers | Notes |
|-------|-------------|---------|-------|
| 1 | Regular PostgreSQL | Not used | Data on coordinator only, Citus not enabled |
| 2 | Citus enabled | W1, W2 registered | Data distributed to workers |
| 3 | Citus active | W1, W2, W3 registered | Rebalanced across 3 workers |
| 4 | Regular PostgreSQL | Disconnected | Data consolidated back |

### Components

**Coordinator Node**
- Entry point for all queries
- Stores distribution metadata in `pg_dist_*` tables
- Plans and routes distributed queries
- Aggregates results from workers

**Worker Nodes**
- Store actual data shards
- Execute query fragments
- Can be added/removed dynamically

**Shards**
- Horizontal slices of a distributed table
- Hash of distribution column determines shard placement
- Default: 32 shards per distributed table

---

## Key Concepts

### 1. Distribution Column (Shard Key)

The column used to determine which shard stores each row.

```sql
-- Distribute orders table by user_id
SELECT create_distributed_table('orders', 'user_id');
```

**Selection Criteria:**
- High cardinality (many distinct values)
- Frequently used in WHERE clauses
- Immutable (doesn't change after insert)
- Even distribution across values

**Good choices:** `user_id`, `tenant_id`, `account_id`
**Bad choices:** `country` (skewed), `created_at` (monotonic), `status` (low cardinality)

### 2. Reference Tables

Small lookup tables replicated to all nodes for efficient joins.

```sql
-- Replicate regions table to all workers
SELECT create_reference_table('regions');
```

Use for:
- Country/region lookups
- Product categories
- Configuration tables
- Any table < 10,000 rows frequently joined

### 3. Shard Placement

Citus uses consistent hashing to place shards:

```sql
-- View shard distribution
SELECT * FROM citus_shards;

-- Detailed placement info
SELECT
    shardid,
    table_name,
    shard_size,
    nodename,
    nodeport
FROM citus_shards;
```

### 4. Colocation

Related tables distributed by the same key are "colocated" - their matching shards live on the same worker.

```sql
-- Orders and order_items colocated by user_id
SELECT create_distributed_table('orders', 'user_id');
SELECT create_distributed_table('order_items', 'user_id',
    colocate_with => 'orders');
```

Benefits:
- Local joins (no network hop)
- Distributed transactions within same user
- Better query performance

### 5. Query Execution Types

**Single-shard queries** (fast):
```sql
-- Routes to one worker only
SELECT * FROM orders WHERE user_id = 123;
```

**Multi-shard queries** (parallel):
```sql
-- Executes on all workers, aggregates on coordinator
SELECT COUNT(*), region FROM orders GROUP BY region;
```

**Cross-shard joins** (requires network):
```sql
-- Non-colocated join requires data shuffling
SELECT * FROM orders o
JOIN products p ON o.product_id = p.id;
```

### 6. Distributed Transactions

Citus supports ACID transactions across shards:

```sql
BEGIN;
INSERT INTO orders (user_id, amount) VALUES (1, 100);
INSERT INTO order_items (user_id, order_id, product) VALUES (1, 1, 'Widget');
COMMIT;
```

Uses 2PC (two-phase commit) for multi-shard transactions.

---

## File Structure

```
04 db-sharding/
├── spec.md                              # This specification
├── README.md                            # Quick start guide
├── todos.md                             # Implementation checklist
├── Dockerfile                           # PostgreSQL 16 + Citus (library only)
├── docker-compose.yml                   # Citus cluster setup
├── .env.example                         # Environment template
├── package.json                         # Node.js dependencies
│
├── scripts/
│   ├── setup/
│   │   ├── 00_create_base_table.sql     # Regular table (Phase 1)
│   │   └── 01_initial_seed_data.sql     # Insert 10K rows
│   │
│   ├── sharding/
│   │   ├── 10_enable_citus.sql          # CREATE EXTENSION citus
│   │   ├── 11_add_workers.sql           # Register worker nodes
│   │   ├── 12_distribute_table.sql      # create_distributed_table()
│   │   ├── 13_create_reference_table.sql  # regions lookup table
│   │   └── 14_verify_distribution.sql   # Check shard placement
│   │
│   ├── queries/
│   │   ├── 20_single_shard_query.sql    # WHERE user_id = X
│   │   ├── 21_cross_shard_query.sql     # Aggregations
│   │   ├── 22_join_queries.sql          # Reference + distributed
│   │   ├── 23_explain_analyze.sql       # Query plans
│   │   └── 24_distribution_stats.sql    # Shard statistics
│   │
│   └── resharding/
│       ├── 30_add_worker_node.sql       # Register idle worker3
│       ├── 31_rebalance_shards.sql      # Redistribute data
│       ├── 32_isolate_tenant.sql        # Move hot tenant
│       ├── 33_drain_worker.sql          # Remove worker safely
│       └── 34_undistribute_table.sql    # Back to regular table
│
├── setup-database.js                    # Initialize cluster (Phase 1)
├── load-data.js                         # Continuous data generator
├── demonstrate-queries.js               # Run example queries with EXPLAIN
├── reshard.js                           # Sharding/resharding orchestration
│
└── utils/
    ├── config.js                        # Environment config
    ├── sql-runner.js                    # Execute SQL files
    ├── data-generator.js                # Generate test records
    └── shard-stats.js                   # Display distribution
```

---

## Implementation Phases

### Phase 1: Regular Table (Baseline)

Create a standard PostgreSQL table before any sharding. At this point, Citus library is loaded but NOT enabled - the database is functionally identical to vanilla PostgreSQL.

**Why this matters:** This demonstrates that you can start with a regular PostgreSQL database, build your application, seed data, and only later decide to add sharding. Citus doesn't require upfront commitment.

**Tables:**

```sql
-- Main table (will become distributed)
CREATE TABLE orders (
    id BIGSERIAL,
    user_id BIGINT NOT NULL,
    region VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (id)
);

-- Lookup table (will become reference)
CREATE TABLE regions (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    timezone VARCHAR(50)
);

-- User table (will become reference or distributed)
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    region_code VARCHAR(10) REFERENCES regions(code),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_region ON orders(region);
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

**Seed Data:**
- 1,000 users across 10 regions
- 10,000 orders distributed across users
- Intentional skew: 20% of users generate 80% of orders

**Baseline Queries:**
```sql
-- Single user orders
SELECT * FROM orders WHERE user_id = 42;

-- Regional aggregation
SELECT region, COUNT(*), SUM(amount)
FROM orders GROUP BY region;

-- Join with lookup
SELECT o.*, r.name as region_name
FROM orders o
JOIN regions r ON o.region = r.code
WHERE o.user_id = 42;
```

**Metrics to Capture:**
- Query execution time
- Rows scanned
- Sequential vs index scans

---

### Phase 2: Distribute Table

Convert existing table to distributed across workers. This is the key transition - taking a regular PostgreSQL table with existing data and making it distributed.

**Step 1: Enable Citus Extension**

This is the moment when Citus functionality becomes available. The extension can be installed at any time - even on a production database with existing data.

```sql
-- Enable Citus (this activates the preloaded library)
CREATE EXTENSION IF NOT EXISTS citus;

-- Verify Citus is active
SELECT citus_version();
```

**Step 2: Add Worker Nodes**
```sql
-- Register workers with coordinator (internal port 5432)
SELECT citus_add_node('worker1', 5432);
SELECT citus_add_node('worker2', 5432);
-- Note: Workers use port 5432 internally within Docker network

-- Verify workers
SELECT * FROM citus_get_active_worker_nodes();
```

**Step 3: Create Reference Table**
```sql
-- Small lookup table replicated everywhere
SELECT create_reference_table('regions');

-- users stays as local table (coordinator only)
-- No action needed - regular PostgreSQL table
```

**Step 4: Distribute Main Table**
```sql
-- Distribute orders by user_id (32 shards by default)
SELECT create_distributed_table('orders', 'user_id');
```

**Step 5: Verify Distribution**
```sql
-- Check shard count and placement
SELECT
    logicalrelid::text AS table_name,
    partmethod,
    colocationid,
    (SELECT COUNT(*) FROM pg_dist_shard WHERE logicalrelid = t.logicalrelid) as shard_count
FROM pg_dist_partition t;

-- View shard locations
SELECT
    s.shardid,
    s.logicalrelid::text as table_name,
    p.nodename,
    p.nodeport,
    pg_size_pretty(s.shardminvalue::bigint) as min_val,
    pg_size_pretty(s.shardmaxvalue::bigint) as max_val
FROM pg_dist_shard s
JOIN pg_dist_placement p ON s.shardid = p.shardid
ORDER BY s.shardid;
```

**Same Queries - Observe Distributed Execution:**
```sql
-- Single-shard (routes to one worker)
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42;

-- Multi-shard (parallel on all workers)
EXPLAIN ANALYZE
SELECT region, COUNT(*), SUM(amount)
FROM orders GROUP BY region;

-- Join with reference table (local on each worker)
EXPLAIN ANALYZE
SELECT o.*, r.name as region_name
FROM orders o
JOIN regions r ON o.region = r.code
WHERE o.user_id = 42;
```

---

### Phase 3: Resharding

Modify the cluster topology and rebalance data.

#### Scenario A: Add Worker Node

```sql
-- Worker3 is already running, just register it with coordinator
SELECT citus_add_node('worker3', 5432);

-- Verify new node
SELECT * FROM citus_get_active_worker_nodes();
```

#### Scenario B: Rebalance Shards

```sql
-- Check current distribution
SELECT nodename, COUNT(*) as shard_count
FROM citus_shards
GROUP BY nodename;

-- Rebalance across all workers
SELECT rebalance_table_shards();

-- Or rebalance specific table
SELECT rebalance_table_shards('orders');

-- Monitor rebalance progress
SELECT * FROM citus_rebalance_status();
```

Rebalancing strategies:
- `by_shard_count` - equal number of shards (default)
- `by_disk_size` - equal disk usage

#### Scenario C: Isolate Hot Tenant

When one user generates disproportionate load:

```sql
-- Check which shard has user 42
SELECT get_shard_id_for_distribution_column('orders', 42);

-- Isolate user 42 to dedicated shard
SELECT isolate_tenant_to_new_shard('orders', 42);

-- Verify isolation
SELECT
    shardid,
    nodename,
    shardminvalue,
    shardmaxvalue
FROM citus_shards
WHERE table_name = 'orders'::regclass;
```

#### Scenario D: Drain Worker (Before Removal)

```sql
-- Move all shards off worker2
SELECT citus_drain_node('worker2', 5432);

-- Monitor progress
SELECT * FROM citus_rebalance_status();

-- Remove drained node from cluster (container keeps running)
SELECT citus_remove_node('worker2', 5432);
```

**Note:** Removing a node from Citus doesn't stop the container - it just unregisters it from the cluster. The container remains available for re-registration later.

---

### Phase 4: Undistribute (Consolidate)

Convert distributed table back to regular PostgreSQL table.

```sql
-- Check current distribution
SELECT * FROM citus_tables;

-- Undistribute (moves all data to coordinator)
SELECT undistribute_table('orders');

-- Verify it's now a regular table
SELECT * FROM citus_tables WHERE table_name = 'orders'::regclass;
-- Should return 0 rows

-- Reference table can also be undistributed
SELECT undistribute_table('regions');

-- users was local, no undistribute needed
```

**Post-Undistribute:**
- All data consolidated on coordinator
- Table is regular PostgreSQL table again
- Can still query normally
- Workers can be stopped if no longer needed

---

## Table Designs

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TABLE RELATIONSHIPS                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐         ┌──────────────────┐         ┌─────────────┐ │
│   │   regions    │         │      users       │         │   orders    │ │
│   │  (Reference) │         │    (Local)       │         │(Distributed)│ │
│   ├──────────────┤         ├──────────────────┤         ├─────────────┤ │
│   │ code (PK)    │◄────────│ region_code (FK) │         │ id          │ │
│   │ name         │         │ id (PK)          │◄────────│ user_id(DK) │ │
│   │ timezone     │         │ email            │         │ region (FK) │──┐
│   │ currency     │         │ name             │         │ product_id  │  │
│   └──────────────┘         │ tier             │         │ amount      │  │
│          ▲                 └──────────────────┘         │ status      │  │
│          │                                              └─────────────┘  │
│          │                                                     │         │
│          │                                                     │         │
│          └─────────────────────────────────────────────────────┼─────────┘
│                                                                │
│                                              ┌─────────────────┘
│                                              │
│                                              ▼
│                                   ┌──────────────────┐
│                                   │   order_items    │
│                                   │  (Distributed)   │
│                                   │   [Colocated]    │
│                                   ├──────────────────┤
│                                   │ id               │
│                                   │ user_id (DK)     │
│                                   │ order_id (FK)    │
│                                   │ product_name     │
│                                   │ quantity         │
│                                   │ unit_price       │
│                                   └──────────────────┘
│                                                                          │
│   Legend:  PK = Primary Key    FK = Foreign Key    DK = Distribution Key │
└─────────────────────────────────────────────────────────────────────────┘
```

### Distribution & Colocation Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SHARD DISTRIBUTION                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  REFERENCE TABLE (replicated to all workers)                             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐        │  │
│  │   │ regions │    │ regions │    │ regions │    │ regions │        │  │
│  │   │ (copy)  │    │ (copy)  │    │ (copy)  │    │ (copy)  │        │  │
│  │   └─────────┘    └─────────┘    └─────────┘    └─────────┘        │  │
│  │   Coordinator      Worker1       Worker2       Worker3            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  LOCAL TABLE (single copy on coordinator only)                           │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │   ┌─────────┐                                                      │  │
│  │   │  users  │    (not on workers - joins require network hop)      │  │
│  │   │ (local) │                                                      │  │
│  │   └─────────┘                                                      │  │
│  │   Coordinator                                                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  DISTRIBUTED TABLES (sharded by user_id, colocated)                      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │      Worker1              Worker2              Worker3             │  │
│  │   ┌───────────┐        ┌───────────┐        ┌───────────┐          │  │
│  │   │ orders    │        │ orders    │        │ orders    │          │  │
│  │   │ shard 1-10│        │ shard 11-21│       │ shard 22-32│         │  │
│  │   │ user_id:  │        │ user_id:  │        │ user_id:  │          │  │
│  │   │ hash 0-33%│        │ hash 34-66%│       │ hash 67-100%│        │  │
│  │   ├───────────┤        ├───────────┤        ├───────────┤          │  │
│  │   │order_items│        │order_items│        │order_items│          │  │
│  │   │ shard 1-10│        │ shard 11-21│       │ shard 22-32│         │  │
│  │   │ (same     │        │ (same     │        │ (same     │          │  │
│  │   │  users)   │        │  users)   │        │  users)   │          │  │
│  │   └───────────┘        └───────────┘        └───────────┘          │  │
│  │                                                                    │  │
│  │   Colocation: orders + order_items with same user_id               │  │
│  │               are ALWAYS on the same worker → local joins          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Query Routing Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           QUERY ROUTING                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. SINGLE-SHARD QUERY (fast - routes to one worker)                     │
│  ───────────────────────────────────────────────────                     │
│     SELECT * FROM orders WHERE user_id = 42;                             │
│                                                                          │
│     ┌─────────────┐                                                      │
│     │ Coordinator │                                                      │
│     │   hash(42)  │──────────────────┐                                   │
│     │   = shard 7 │                  │                                   │
│     └─────────────┘                  ▼                                   │
│                              ┌─────────────┐                             │
│         Worker1              │   Worker2   │         Worker3             │
│        (skip)                │  shard 7 ✓  │        (skip)               │
│                              └─────────────┘                             │
│                                                                          │
│  2. MULTI-SHARD QUERY (parallel - all workers)                           │
│  ─────────────────────────────────────────────                           │
│     SELECT region, SUM(amount) FROM orders GROUP BY region;              │
│                                                                          │
│     ┌─────────────┐                                                      │
│     │ Coordinator │──────┬──────────┬──────────┐                         │
│     │  aggregate  │      │          │          │                         │
│     └─────────────┘      ▼          ▼          ▼                         │
│                    ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│                    │ Worker1 │ │ Worker2 │ │ Worker3 │                   │
│                    │partial ∑│ │partial ∑│ │partial ∑│                   │
│                    └─────────┘ └─────────┘ └─────────┘                   │
│                                                                          │
│  3. COLOCATED JOIN (local - no network shuffle)                          │
│  ──────────────────────────────────────────────                          │
│     SELECT * FROM orders o                                               │
│     JOIN order_items oi ON o.user_id = oi.user_id                        │
│     WHERE o.user_id = 42;                                                │
│                                                                          │
│     ┌─────────────┐                                                      │
│     │ Coordinator │──────────────────┐                                   │
│     └─────────────┘                  ▼                                   │
│                              ┌───────────────┐                           │
│                              │    Worker2    │                           │
│                              │ ┌───────────┐ │                           │
│                              │ │  orders   │ │                           │
│                              │ │  shard 7  │ │                           │
│                              │ └─────┬─────┘ │                           │
│                              │   LOCAL JOIN  │                           │
│                              │ ┌─────┴─────┐ │                           │
│                              │ │order_items│ │                           │
│                              │ │  shard 7  │ │                           │
│                              │ └───────────┘ │                           │
│                              └───────────────┘                           │
│                                                                          │
│  4. CROSS-SHARD JOIN (slow - requires data shuffle)                      │
│  ──────────────────────────────────────────────────                      │
│     -- Joining on non-distribution column (product_id)                   │
│     SELECT o.*, p.name FROM orders o                                     │
│     JOIN products p ON o.product_id = p.id;                              │
│                                                                          │
│     ┌─────────────┐                                                      │
│     │ Coordinator │                                                      │
│     │  (plan &    │                                                      │
│     │  combine)   │                                                      │
│     └──────┬──────┘                                                      │
│            │ broadcast/repartition                                       │
│     ┌──────┴──────┬──────────────┬──────────────┐                        │
│     ▼             ▼              ▼              ▼                        │
│  ┌───────┐   ┌───────┐      ┌───────┐      ┌───────┐                     │
│  │  W1   │   │  W2   │      │  W3   │      │  W1   │                     │
│  │orders │──▶│products│     │orders │──▶   │products│                    │
│  │shard 1│   │(copy) │      │shard 2│      │(copy) │                     │
│  └───────┘   └───────┘      └───────┘      └───────┘                     │
│       └──────────┴───────────────┴──────────────┘                        │
│                         │                                                │
│                   Data shuffled                                          │
│                   across network                                         │
│                                                                          │
│  ⚠️  Strategies to avoid cross-shard joins:                              │
│     • Make products a REFERENCE table (replicated everywhere)            │
│     • Include user_id in products and colocate                           │
│     • Denormalize product data into orders                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### orders (Distributed Table)

```sql
CREATE TABLE orders (
    id BIGSERIAL,
    user_id BIGINT NOT NULL,          -- Distribution column
    region VARCHAR(50) NOT NULL,
    product_id BIGINT,
    quantity INTEGER DEFAULT 1,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    PRIMARY KEY (user_id, id)          -- Must include distribution column
);

-- Distribute by user_id
SELECT create_distributed_table('orders', 'user_id');
```

**Note:** Primary key must include the distribution column for distributed tables.

### users (Local Table)

```sql
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100),
    region_code VARCHAR(10),
    tier VARCHAR(20) DEFAULT 'standard',  -- standard, premium, enterprise
    created_at TIMESTAMP DEFAULT NOW()
);

-- Local table: stays on coordinator only (no distribution)
-- Joins with distributed tables require pulling data to coordinator
-- Use when: table is large OR rarely joined with distributed tables
```

**Tradeoff: Reference vs Local**

| Type | Storage | Join Performance | Best For |
|------|---------|------------------|----------|
| Reference | N copies (all nodes) | Fast (local) | Small lookup tables (<10K rows) |
| Local | 1 copy (coordinator) | Slower (network hop) | Large tables, infrequent joins |

### regions (Reference Table)

```sql
CREATE TABLE regions (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    timezone VARCHAR(50),
    currency VARCHAR(3) DEFAULT 'USD'
);

INSERT INTO regions (code, name, timezone) VALUES
    ('US-EAST', 'US East', 'America/New_York'),
    ('US-WEST', 'US West', 'America/Los_Angeles'),
    ('EU-WEST', 'Europe West', 'Europe/London'),
    ('EU-CENT', 'Europe Central', 'Europe/Berlin'),
    ('APAC-NE', 'Asia Pacific Northeast', 'Asia/Tokyo'),
    ('APAC-SE', 'Asia Pacific Southeast', 'Asia/Singapore'),
    ('SA-EAST', 'South America East', 'America/Sao_Paulo'),
    ('AF-SOUTH', 'Africa South', 'Africa/Johannesburg'),
    ('ME-WEST', 'Middle East West', 'Asia/Dubai'),
    ('OC-EAST', 'Oceania East', 'Australia/Sydney');

SELECT create_reference_table('regions');
```

### order_items (Colocated Distributed Table)

```sql
CREATE TABLE order_items (
    id BIGSERIAL,
    user_id BIGINT NOT NULL,           -- Same distribution column as orders
    order_id BIGINT NOT NULL,
    product_name VARCHAR(200),
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2),

    PRIMARY KEY (user_id, id)
);

-- Colocate with orders for efficient joins
SELECT create_distributed_table('order_items', 'user_id',
    colocate_with => 'orders');
```

---

## package.json

```json
{
  "name": "postgresql-sharding-demo",
  "version": "1.0.0",
  "description": "PostgreSQL Sharding with Citus - from regular table to distributed and back",
  "scripts": {
    "setup": "node setup-database.js",
    "load": "node load-data.js",
    "demo": "node demonstrate-queries.js",

    "phase1": "npm run setup && npm run demo",
    "phase2": "node reshard.js enable-citus && npm run demo",
    "phase3": "node reshard.js add-worker && node reshard.js rebalance && npm run demo",
    "phase4": "node reshard.js undistribute && npm run demo",

    "enable-citus": "node reshard.js enable-citus",
    "add-worker": "node reshard.js add-worker",
    "rebalance": "node reshard.js rebalance",
    "isolate": "node reshard.js isolate",
    "drain": "node reshard.js drain",
    "undistribute": "node reshard.js undistribute",

    "all": "npm run phase1 && npm run phase2 && npm run phase3 && npm run phase4"
  },
  "keywords": ["postgresql", "citus", "sharding", "distributed"],
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

Initializes the database with base tables (Phase 1 - no Citus yet).

```javascript
// Usage: node setup-database.js
// - Connects to coordinator (as regular PostgreSQL)
// - Creates base tables (orders, users, regions)
// - Seeds initial data
// - NO Citus extension created - that's Phase 2
```

### load-data.js

Continuously generates test data.

```javascript
// Usage: node load-data.js [interval_ms] [duration_sec]
// Example: node load-data.js 100 60
// - Inserts orders at specified interval
// - Shows insert rate statistics
// - Graceful shutdown on SIGINT
```

### demonstrate-queries.js

Runs example queries with EXPLAIN output.

```javascript
// Usage: node demonstrate-queries.js [query_type]
// Types: single-shard, cross-shard, join, aggregate, all
// - Executes queries
// - Shows EXPLAIN ANALYZE output
// - Compares distributed vs non-distributed performance
```

### reshard.js

Orchestrates sharding and resharding operations.

```javascript
// Usage: node reshard.js <scenario>
// Scenarios:
//   enable-citus   - Phase 2: CREATE EXTENSION, add workers, distribute
//   add-worker     - Phase 3: Add worker3 to cluster
//   rebalance      - Phase 3: Redistribute shards evenly
//   isolate        - Phase 3: Isolate hot tenant
//   drain          - Phase 3: Drain and remove worker
//   undistribute   - Phase 4: Convert back to regular table
```

---

## Execution Flow (How to Run the Demo)

### Quick Start (using npm scripts)

```bash
# Install dependencies & start cluster
npm install
docker-compose up -d --build

# Run all 4 phases automatically
npm run all

# Or run phases individually
npm run phase1    # Setup + baseline queries
npm run phase2    # Enable Citus + distributed queries
npm run phase3    # Add worker + rebalance + queries
npm run phase4    # Undistribute + regular queries
```

### Phase-by-Phase Execution

| Phase | npm Script | What It Does |
|-------|------------|--------------|
| **1** | `npm run phase1` | Create tables, seed 10K rows, run baseline queries |
| **1** | `npm run load` | (Optional) Add more data |
| **2** | `npm run phase2` | CREATE EXTENSION, add W1+W2, distribute, run queries |
| **3** | `npm run phase3` | Add worker3, rebalance shards, run queries |
| **3** | `npm run isolate` | (Optional) Isolate hot tenant to own shard |
| **3** | `npm run drain` | (Optional) Remove a worker safely |
| **4** | `npm run phase4` | Consolidate all data back, run queries |

### Individual Commands (Alternative)

| Command | Description |
|---------|-------------|
| `npm run setup` | Phase 1: Create tables, seed data |
| `npm run demo` | Run demonstration queries |
| `npm run enable-citus` | Phase 2: Enable extension, distribute |
| `npm run add-worker` | Phase 3: Register worker3 |
| `npm run rebalance` | Phase 3: Redistribute shards |
| `npm run undistribute` | Phase 4: Back to regular table |

### What to Observe at Each Phase

**Phase 1 (Regular PostgreSQL):**
```bash
npm run demo
# EXPLAIN shows: Seq Scan, Index Scan - standard PostgreSQL plans
# No mention of workers or shards
```

**Phase 2 (Distributed):**
```bash
npm run demo
# EXPLAIN shows: "Task: router executor" for single-shard queries
# EXPLAIN shows: "Task: adaptive executor" for multi-shard queries
# Query routes to worker1 or worker2
```

**Phase 3 (Resharded):**
```bash
npm run demo
# Shards now spread across 3 workers
# Check distribution: SELECT * FROM citus_shards;
```

**Phase 4 (Undistributed):**
```bash
npm run demo
# Back to standard PostgreSQL plans
# All data on coordinator
# SELECT * FROM citus_tables; returns empty
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

### Shard Distribution

```sql
-- Shards per worker
SELECT
    nodename,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;
```

### Row Distribution

```sql
-- Approximate rows per shard
SELECT
    shardid,
    table_name::text,
    nodename,
    shard_size,
    (SELECT COUNT(*) FROM orders_102008) as row_count  -- Replace with actual shard
FROM citus_shards
WHERE table_name = 'orders'::regclass
LIMIT 5;
```

### Query Statistics

```sql
-- Distributed query stats (requires pg_stat_statements)
SELECT
    query,
    calls,
    mean_exec_time,
    rows
FROM pg_stat_statements
WHERE query LIKE '%orders%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Active Connections

```sql
-- Connections per node
SELECT
    nodename,
    COUNT(*) as connections
FROM citus_stat_activity
GROUP BY nodename;
```

---

## Docker Configuration

### Dockerfile (Custom PostgreSQL + Citus)

```dockerfile
# Build Citus on top of standard PostgreSQL
FROM postgres:16

# Install build dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       gnupg \
       lsb-release \
    # Add Citus repository
    && curl https://install.citusdata.com/community/deb.sh | bash \
    # Install Citus extension for PostgreSQL 16
    && apt-get install -y --no-install-recommends \
       postgresql-16-citus-12.1 \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configure PostgreSQL to preload Citus library
# NOTE: This only LOADS the library - it does NOT create the extension!
# The extension is created explicitly in Phase 2 with CREATE EXTENSION citus
RUN echo "shared_preload_libraries = 'citus'" >> /usr/share/postgresql/postgresql.conf.sample
```

**Important:** The `shared_preload_libraries` setting loads the Citus shared library into PostgreSQL memory at startup. This is a prerequisite for creating the extension later, but it does NOT enable Citus functionality. Until you run `CREATE EXTENSION citus`, the database behaves as standard PostgreSQL.

This design allows us to:
1. **Phase 1**: Use regular PostgreSQL tables with seed data
2. **Phase 2**: Enable Citus with `CREATE EXTENSION citus` and distribute existing data

### docker-compose.yml

```yaml
version: '3.8'

services:
  coordinator:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: citus_coordinator
    ports:
      - "5440:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-sharding_demo}
    volumes:
      - coordinator_data:/var/lib/postgresql/data
    networks:
      - citus_network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker1:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: citus_worker1
    ports:
      - "5441:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-sharding_demo}
    volumes:
      - worker1_data:/var/lib/postgresql/data
    networks:
      - citus_network
    depends_on:
      coordinator:
        condition: service_healthy

  worker2:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: citus_worker2
    ports:
      - "5442:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-sharding_demo}
    volumes:
      - worker2_data:/var/lib/postgresql/data
    networks:
      - citus_network
    depends_on:
      coordinator:
        condition: service_healthy

  # Third worker (available but not registered initially)
  worker3:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: citus_worker3
    ports:
      - "5443:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-sharding_demo}
    volumes:
      - worker3_data:/var/lib/postgresql/data
    networks:
      - citus_network
    depends_on:
      coordinator:
        condition: service_healthy

volumes:
  coordinator_data:
  worker1_data:
  worker2_data:
  worker3_data:

networks:
  citus_network:
    driver: bridge
```

### How Citus Installation Works

1. **Base image**: Standard `postgres:16`
2. **Add Citus repo**: `curl https://install.citusdata.com/community/deb.sh | bash`
3. **Install extension package**: `apt-get install postgresql-16-citus-12.1`
4. **Preload library**: Add `shared_preload_libraries = 'citus'` to postgresql.conf
5. **Enable extension later**: `CREATE EXTENSION citus` is run in Phase 2 (NOT on init)

**Why delay enabling?** This demonstrates that you can add sharding to an existing database. The Citus library is loaded at startup (required), but the extension is only created when you're ready to distribute tables.

### Starting the Cluster

```bash
# Build image and start all nodes (first run builds PostgreSQL+Citus image)
docker-compose up -d --build

# Subsequent starts (no rebuild needed)
docker-compose up -d

# View logs
docker-compose logs -f coordinator

# Stop cluster
docker-compose down

# Stop and remove volumes (clean reset)
docker-compose down -v

# Rebuild image (after Dockerfile changes)
docker-compose build --no-cache
```

**Note:** All containers start together, but in Phase 1 they're just regular PostgreSQL instances. No workers are registered until Phase 2 when you enable Citus. Worker3 remains idle until Phase 3 (resharding).

---

## Environment Variables

### .env.example

```bash
# Coordinator connection (app connects here)
POSTGRES_HOST=localhost
POSTGRES_PORT=5440
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=sharding_demo

# Worker nodes (for direct debugging)
WORKER1_HOST=localhost
WORKER1_PORT=5441
WORKER2_HOST=localhost
WORKER2_PORT=5442
WORKER3_HOST=localhost
WORKER3_PORT=5443

# Data generation
SEED_USERS=1000
SEED_ORDERS=10000
HOT_USER_PERCENTAGE=20   # % of users generating 80% of orders
```

---

## Common Operations

### Check Cluster Health

```sql
-- All nodes healthy?
SELECT * FROM citus_check_cluster_node_health();

-- Active workers
SELECT * FROM citus_get_active_worker_nodes();

-- Coordinator metadata
SELECT * FROM pg_dist_node;
```

### Troubleshooting

```sql
-- Failed shard placements
SELECT * FROM pg_dist_placement WHERE shardstate = 3;

-- Lock conflicts
SELECT * FROM citus_lock_waits;

-- Long-running queries
SELECT * FROM citus_stat_activity
WHERE state = 'active'
AND query_start < NOW() - INTERVAL '1 minute';
```

### Performance Tuning

```sql
-- Parallel query settings
SET citus.max_adaptive_executor_pool_size = 16;

-- Shard count for new tables (before distribution)
SET citus.shard_count = 64;

-- Replication factor (for fault tolerance)
SET citus.shard_replication_factor = 2;
```

---

## Success Criteria

### Phase 1: Regular Table (No Citus)
- [ ] Tables created successfully (regular PostgreSQL)
- [ ] 10,000+ orders seeded
- [ ] Citus extension NOT created yet
- [ ] Queries return correct results
- [ ] Baseline performance captured

### Phase 2: Distributed Table
- [ ] Citus extension enabled
- [ ] Workers registered and healthy
- [ ] Tables distributed across workers
- [ ] Shards visible in citus_shards
- [ ] Queries still return same results
- [ ] EXPLAIN shows distributed execution

### Phase 3: Resharding
- [ ] Third worker added successfully
- [ ] Shards rebalanced across 3 workers
- [ ] Tenant isolation works
- [ ] Worker drain completes without data loss
- [ ] Queries work during rebalancing

### Phase 4: Undistribute
- [ ] Table converted to regular PostgreSQL
- [ ] All data consolidated on coordinator
- [ ] Queries work on regular table
- [ ] Workers can be stopped safely

---

## Educational Demonstrations

### Demo 1: Shard Key Selection Impact

Compare distribution with different columns:

```sql
-- Good: user_id (high cardinality, even distribution)
SELECT create_distributed_table('orders_by_user', 'user_id');

-- Bad: region (low cardinality, skewed)
SELECT create_distributed_table('orders_by_region', 'region');

-- Compare shard sizes
SELECT table_name, nodename, shard_size
FROM citus_shards
WHERE table_name IN ('orders_by_user', 'orders_by_region')
ORDER BY table_name, nodename;
```

### Demo 2: Query Routing

```sql
-- Single shard (check Task column in EXPLAIN)
EXPLAIN (COSTS OFF) SELECT * FROM orders WHERE user_id = 42;
-- Shows: Task: router executor

-- All shards
EXPLAIN (COSTS OFF) SELECT COUNT(*) FROM orders;
-- Shows: Task: adaptive executor (parallel)
```

### Demo 3: Colocation Benefits

```sql
-- With colocation: local join
EXPLAIN ANALYZE
SELECT o.*, oi.*
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42;

-- Without colocation: requires data shuffle
-- (would show repartition or broadcast in plan)
```

### Demo 4: Reference Table Join

```sql
-- Reference tables are local on every worker
EXPLAIN ANALYZE
SELECT o.*, r.name as region_name, u.email
FROM orders o
JOIN regions r ON o.region = r.code
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 42;
-- No network hop for reference table joins
```

---

## Next Steps

After completing this demo:

1. **Multi-tenant SaaS patterns** - Schema-based sharding (Citus 12+)
2. **High availability** - Shard replication and failover
3. **Real-time analytics** - Columnar storage with citus_columnar
4. **Change data capture** - Streaming changes from distributed tables
5. **Connection pooling** - PgBouncer with Citus
