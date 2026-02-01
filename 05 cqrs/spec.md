# PostgreSQL CQRS — E-Commerce Order Analytics

## Overview

This project demonstrates **Command Query Responsibility Segregation (CQRS)** in PostgreSQL. Instead of using a single data model for both reads and writes, CQRS separates the write model (normalized OLTP tables) from the read model (denormalized analytics tables optimized for specific query patterns).

### Single Model vs CQRS

| Aspect | Single Model | CQRS |
|--------|-------------|------|
| Read performance | Degrades with JOINs at scale | Pre-computed, constant time |
| Write performance | Fast (normalized) | Same write side + sync overhead |
| Data consistency | Always consistent | Depends on sync strategy |
| Complexity | Simple | Higher (two models + sync) |
| Schema flexibility | One schema fits all | Optimized per use case |
| Scalability | Limited by JOIN cost | Read/write scale independently |

### Why CQRS with PostgreSQL?

- PostgreSQL has native support for all three sync strategies: Materialized Views, Triggers, LISTEN/NOTIFY
- No external message brokers or infrastructure needed
- Demonstrates the pattern with minimal dependencies
- Production-relevant: many real systems use PostgreSQL CQRS for dashboards, analytics, and reporting

### Demo Objectives

1. **Start with normalized tables** — standard e-commerce schema, analytics queries via JOINs (slow)
2. **Add materialized views** — pre-computed read models, fast reads but stale between refreshes
3. **Switch to trigger-based sync** — real denormalized tables updated on every write (always consistent, write overhead)
4. **Switch to async LISTEN/NOTIFY** — lightweight notifications + background worker (fast writes, eventual consistency)

**Key Learning:** CQRS is not a binary choice. There's a spectrum of sync strategies with different trade-offs between consistency, write overhead, and complexity. PostgreSQL supports all of them natively.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CQRS E-COMMERCE ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│          WRITE PATH                           READ PATH                  │
│      (Normalized OLTP)                   (Denormalized Analytics)        │
│                                                                          │
│   ┌──────────────┐                       ┌────────────────────────┐     │
│   │    users     │                       │ read_revenue_by_region │     │
│   │  (5K rows)   │                       │  (10 rows - 1 per      │     │
│   └──────────────┘                       │   region)              │     │
│                                          └────────────────────────┘     │
│   ┌──────────────┐         SYNC          ┌────────────────────────┐     │
│   │   products   │      ═════════►       │   read_top_products   │     │
│   │  (100 rows)  │                       │  (100 rows - all       │     │
│   └──────────────┘                       │   products ranked)     │     │
│                                          └────────────────────────┘     │
│   ┌──────────────┐                       ┌────────────────────────┐     │
│   │   orders     │                       │  read_user_spending   │     │
│   │ (100K rows)  │                       │  (5K rows - 1 per     │     │
│   └──────────────┘                       │   user)               │     │
│                                          └────────────────────────┘     │
│   ┌──────────────┐                       ┌────────────────────────┐     │
│   │ order_items  │                       │   read_daily_stats    │     │
│   │ (250K rows)  │                       │  (~365 rows - 1 per   │     │
│   └──────────────┘                       │   day)                │     │
│                                          └────────────────────────┘     │
│                                                                          │
│   Phase 2: Materialized Views  (REFRESH on demand, stale between)       │
│   Phase 3: Triggers            (sync on each write, always consistent)  │
│   Phase 4: LISTEN/NOTIFY       (async worker, eventual consistency)     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Architecture Evolution by Phase:**

| Phase | Write Model | Read Model | Sync | Consistency |
|-------|-------------|------------|------|-------------|
| 1 | Normalized tables | Same tables (JOINs) | None | Perfect (single model) |
| 2 | Normalized tables | Materialized Views | REFRESH command | Stale until refresh |
| 3 | Normalized tables | Denormalized tables | Triggers (synchronous) | Always consistent |
| 4 | Normalized tables | Denormalized tables | LISTEN/NOTIFY (async) | Eventually consistent |

### Sync Strategy Comparison

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SYNC STRATEGY COMPARISON                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Phase 2: MATERIALIZED VIEWS                                             │
│  ───────────────────────────                                             │
│                                                                          │
│   INSERT INTO orders ──► orders table         mat_view (STALE)          │
│                                                  │                      │
│   REFRESH MATERIALIZED VIEW ─────────────────────┘                      │
│   (explicit, full recompute)        mat_view (FRESH)                    │
│                                                                          │
│   + Simplest to set up                                                  │
│   + No write overhead                                                   │
│   - Stale between refreshes                                             │
│   - Full recompute on each REFRESH (O(n) cost)                          │
│                                                                          │
│  Phase 3: TRIGGER-BASED SYNC                                             │
│  ───────────────────────────                                             │
│                                                                          │
│   INSERT INTO orders ──► orders table                                    │
│          │                                                               │
│          └──► TRIGGER ──► UPDATE read_revenue_by_region                  │
│                       ──► UPDATE read_top_products                       │
│                       ──► UPDATE read_user_spending                      │
│                       ──► UPDATE read_daily_stats                        │
│                                                                          │
│   + Always consistent (same transaction)                                │
│   + Incremental (O(1) per write)                                        │
│   - Write overhead (4 extra UPDATEs per INSERT)                         │
│   - Trigger logic can become complex                                    │
│                                                                          │
│  Phase 4: LISTEN/NOTIFY (ASYNC)                                          │
│  ──────────────────────────────                                          │
│                                                                          │
│   INSERT INTO orders ──► orders table                                    │
│          │                                                               │
│          └──► NOTIFY 'order_changes' ──► [channel]                      │
│                                              │                          │
│                                         sync-worker.js                   │
│                                         (LISTEN 'order_changes')        │
│                                              │                          │
│                                    batch UPDATE read tables              │
│                                    (every N ms or N events)             │
│                                                                          │
│   + Minimal write overhead (just NOTIFY)                                │
│   + Batched updates (efficient)                                         │
│   + Read/write independently scalable                                   │
│   - Eventually consistent (lag = batch interval)                        │
│   - Requires background worker process                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### 1. Command Query Responsibility Segregation (CQRS)

Separate the data model used for writes (commands) from the data model used for reads (queries).

**Write model** — normalized, optimized for transactional integrity:
```sql
-- Writing an order requires touching 2 tables
INSERT INTO orders (user_id, region, status, total_amount)
VALUES (42, 'US-EAST', 'pending', 150.00)
RETURNING id;

INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
VALUES (1001, 5, 2, 75.00, 150.00);
```

**Read model** — denormalized, optimized for specific query patterns:
```sql
-- Dashboard query: single table scan, no JOINs
SELECT * FROM read_revenue_by_region ORDER BY total_revenue DESC;

-- User analytics: single row lookup
SELECT * FROM read_user_spending WHERE user_id = 42;
```

### 2. Materialized Views

PostgreSQL's built-in mechanism for pre-computed query results.

```sql
-- Create a materialized view
CREATE MATERIALIZED VIEW mv_revenue_by_region AS
SELECT
    o.region,
    SUM(o.total_amount) AS total_revenue,
    COUNT(*) AS order_count,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY o.region;

-- Create unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_mv_revenue_region ON mv_revenue_by_region (region);

-- Refresh (blocks readers during refresh)
REFRESH MATERIALIZED VIEW mv_revenue_by_region;

-- Refresh concurrently (doesn't block readers, requires unique index)
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_by_region;
```

**Key trade-off:** Zero write overhead, but data is stale between refreshes. Refresh is O(n) — recomputes the entire view from scratch.

### 3. Trigger-Based Synchronization

Use PostgreSQL triggers to update read models on every write operation.

```sql
-- Trigger function: update revenue on new order
CREATE OR REPLACE FUNCTION sync_revenue_on_order_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO read_revenue_by_region (region, total_revenue, order_count, avg_order_value)
    VALUES (NEW.region, NEW.total_amount, 1, NEW.total_amount)
    ON CONFLICT (region) DO UPDATE SET
        total_revenue = read_revenue_by_region.total_revenue + NEW.total_amount,
        order_count = read_revenue_by_region.order_count + 1,
        avg_order_value = (read_revenue_by_region.total_revenue + NEW.total_amount)
                        / (read_revenue_by_region.order_count + 1),
        last_updated = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
CREATE TRIGGER trg_order_insert_revenue
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sync_revenue_on_order_insert();
```

**Key trade-off:** Always consistent (trigger runs in same transaction), but adds write overhead (multiple UPDATEs per INSERT). Write amplification grows with number of read models.

### 4. LISTEN/NOTIFY Asynchronous Sync

PostgreSQL's built-in pub/sub mechanism for lightweight change notifications.

```sql
-- Trigger: send notification instead of updating read models directly
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('order_changes', json_build_object(
        'operation', TG_OP,
        'order_id', NEW.id,
        'user_id', NEW.user_id,
        'region', NEW.region,
        'total_amount', NEW.total_amount,
        'status', NEW.status
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Node.js worker (sync-worker.js):**
```javascript
// Listen for notifications and batch-update read models
client.on('notification', (msg) => {
    const payload = JSON.parse(msg.payload);
    pendingChanges.push(payload);
});

await client.query('LISTEN order_changes');

// Batch flush every N milliseconds
setInterval(async () => {
    if (pendingChanges.length > 0) {
        await flushToReadModels(pendingChanges);
        pendingChanges = [];
    }
}, BATCH_INTERVAL_MS);
```

**Key trade-off:** Minimal write overhead (just NOTIFY is very cheap), reads are fast from denormalized tables, but there's a consistency lag equal to the batch interval.

### 5. Read Model Freshness

Each read table tracks its own freshness:

```sql
-- Check when each read model was last updated
SELECT
    'read_revenue_by_region' AS model,
    MAX(last_updated) AS last_refreshed,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated))) AS staleness_seconds
FROM read_revenue_by_region
UNION ALL
SELECT
    'read_top_products',
    MAX(last_updated),
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))
FROM read_top_products;
```

### 6. Write Amplification

Measure the overhead of keeping read models in sync:

```sql
-- Baseline: insert 1000 orders (no triggers)
-- Triggers: insert 1000 orders (with 4 trigger-based read model updates)
-- NOTIFY: insert 1000 orders (with lightweight NOTIFY)

-- Compare: total write duration at each phase
```

---

## File Structure

```
05 cqrs/
├── spec.md                              # This specification
├── README.md                            # Quick start guide
├── todos.md                             # Implementation checklist
├── docker-compose.yml                   # PostgreSQL 16 setup
├── .env.example                         # Environment template
├── package.json                         # Node.js dependencies & scripts
│
├── scripts/
│   ├── setup/
│   │   ├── 00_create_tables.sql         # Write-side schema (users, products, orders, order_items)
│   │   └── 01_seed_data.sql             # Reference data (products catalog, regions)
│   │
│   ├── materialized-views/
│   │   ├── 10_create_mat_views.sql      # 4 materialized views + unique indexes
│   │   └── 11_refresh_views.sql         # REFRESH MATERIALIZED VIEW CONCURRENTLY
│   │
│   ├── triggers/
│   │   ├── 20_create_read_tables.sql    # 4 denormalized read tables
│   │   ├── 21_sync_triggers.sql         # Trigger functions for INSERT/UPDATE/DELETE
│   │   └── 22_initial_populate.sql      # Backfill read tables from existing data
│   │
│   ├── notify/
│   │   ├── 30_notify_triggers.sql       # Lightweight NOTIFY triggers on orders/order_items
│   │   └── 31_create_read_tables.sql    # Read tables (reuse if already exist)
│   │
│   └── queries/
│       ├── 40_baseline_queries.sql      # Analytics via JOINs on normalized tables
│       ├── 41_read_model_queries.sql    # Same analytics on read models (mat views or tables)
│       └── 42_write_benchmarks.sql      # Write performance measurement queries
│
├── setup-database.js                    # Phase 1: Initialize tables, seed data
├── sync-models.js                       # Phase 2-4: Sync strategy orchestrator
├── demonstrate-queries.js               # Run queries with EXPLAIN and timing comparison
├── load-data.js                         # Continuous order generation
├── sync-worker.js                       # Phase 4: LISTEN/NOTIFY background worker
│
└── utils/
    ├── config.js                        # Environment config & connection strings
    ├── sql-runner.js                    # SQL file executor with timing
    ├── data-generator.js                # User, product, order, order_item generators
    └── cqrs-stats.js                    # Read model freshness & sync lag monitoring
```

---

## Implementation Phases

### Phase 1: Baseline (No CQRS)

Create a standard e-commerce database. Analytics queries run directly against normalized tables using JOINs. This is the "before" benchmark — establishing how slow complex analytics get on normalized data.

**Why this matters:** This demonstrates the problem that CQRS solves. Dashboard queries that JOIN multiple tables with GROUP BY and aggregations become progressively slower as data grows, while the write model remains fast.

**Tables:**

```sql
-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    region_code VARCHAR(10) NOT NULL,
    tier VARCHAR(20) DEFAULT 'standard',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products catalog
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    region VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    total_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order line items
CREATE TABLE order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(10,2) NOT NULL
);

-- Indexes
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_region ON orders(region);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
```

**Seed Data:**
- 10 regions (US-EAST, US-WEST, EU-WEST, EU-CENT, APAC-NE, APAC-SE, SA-EAST, AF-SOUTH, ME-WEST, OC-EAST)
- 100 products across 10 categories
- 5,000 users across regions with tiers (standard/premium/enterprise)
- 100,000 orders with Pareto distribution (20% hot users → 80% orders)
- ~250,000 order items (avg 2.5 items per order)

**Baseline Queries (slow on normalized data):**

```sql
-- Dashboard: Revenue by region (requires JOIN + GROUP BY)
SELECT
    o.region,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY o.region
ORDER BY total_revenue DESC;

-- Dashboard: Top 10 products (requires 2 JOINs + GROUP BY)
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.category,
    SUM(oi.quantity) AS total_sold,
    SUM(oi.line_total) AS total_revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
JOIN orders o ON oi.order_id = o.id
WHERE o.status != 'cancelled'
GROUP BY p.id, p.name, p.category
ORDER BY total_revenue DESC
LIMIT 10;

-- User analytics: Top spenders (requires JOIN + GROUP BY + subquery)
SELECT
    u.id AS user_id,
    u.name,
    u.region_code,
    u.tier,
    COUNT(o.id) AS order_count,
    SUM(o.total_amount) AS total_spent,
    AVG(o.total_amount) AS avg_order_value,
    MAX(o.created_at) AS last_order_at
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status != 'cancelled'
GROUP BY u.id, u.name, u.region_code, u.tier
ORDER BY total_spent DESC
LIMIT 20;

-- Daily stats (requires GROUP BY on date + subqueries)
SELECT
    DATE(o.created_at) AS stat_date,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    COUNT(DISTINCT o.user_id) AS unique_customers,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY DATE(o.created_at)
ORDER BY stat_date DESC
LIMIT 30;
```

**Metrics to Capture:**
- Query execution time for each analytics query
- Rows scanned (from EXPLAIN ANALYZE)
- Plan type (Seq Scan, Index Scan, Hash Join, etc.)

---

### Phase 2: Materialized Views

Create materialized views that pre-compute the same analytics. Queries become instant lookups instead of JOINs.

**Step 1: Create Materialized Views**

```sql
-- Revenue by region (materialized)
CREATE MATERIALIZED VIEW mv_revenue_by_region AS
SELECT
    o.region,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY o.region;

CREATE UNIQUE INDEX idx_mv_revenue_region ON mv_revenue_by_region (region);

-- Top products (materialized)
CREATE MATERIALIZED VIEW mv_top_products AS
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.category,
    SUM(oi.quantity) AS total_sold,
    SUM(oi.line_total) AS total_revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
JOIN orders o ON oi.order_id = o.id
WHERE o.status != 'cancelled'
GROUP BY p.id, p.name, p.category;

CREATE UNIQUE INDEX idx_mv_top_products ON mv_top_products (product_id);

-- User spending (materialized)
CREATE MATERIALIZED VIEW mv_user_spending AS
SELECT
    u.id AS user_id,
    u.name AS user_name,
    u.region_code,
    u.tier,
    COUNT(o.id) AS order_count,
    SUM(o.total_amount) AS total_spent,
    AVG(o.total_amount) AS avg_order_value,
    MAX(o.created_at) AS last_order_at
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status != 'cancelled'
GROUP BY u.id, u.name, u.region_code, u.tier;

CREATE UNIQUE INDEX idx_mv_user_spending ON mv_user_spending (user_id);

-- Daily stats (materialized)
CREATE MATERIALIZED VIEW mv_daily_stats AS
SELECT
    DATE(o.created_at) AS stat_date,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    COUNT(DISTINCT o.user_id) AS unique_customers,
    AVG(o.total_amount) AS avg_order_value,
    (SELECT region FROM orders o2
     WHERE DATE(o2.created_at) = DATE(o.created_at) AND o2.status != 'cancelled'
     GROUP BY region ORDER BY SUM(total_amount) DESC LIMIT 1
    ) AS top_region
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY DATE(o.created_at);

CREATE UNIQUE INDEX idx_mv_daily_stats ON mv_daily_stats (stat_date);
```

**Step 2: Query Materialized Views**

```sql
-- Same analytics, now instant (single table scan, no JOINs)
SELECT * FROM mv_revenue_by_region ORDER BY total_revenue DESC;
SELECT * FROM mv_top_products ORDER BY total_revenue DESC LIMIT 10;
SELECT * FROM mv_user_spending ORDER BY total_spent DESC LIMIT 20;
SELECT * FROM mv_daily_stats ORDER BY stat_date DESC LIMIT 30;
```

**Step 3: Demonstrate Staleness**

```sql
-- Insert new orders
INSERT INTO orders (user_id, region, status, total_amount)
VALUES (1, 'US-EAST', 'completed', 500.00);

-- Mat view still shows OLD data (stale)
SELECT * FROM mv_revenue_by_region WHERE region = 'US-EAST';

-- Refresh to get current data
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_by_region;

-- Now shows NEW data
SELECT * FROM mv_revenue_by_region WHERE region = 'US-EAST';
```

**Metrics to Capture:**
- Read query time (mat view vs baseline JOINs)
- REFRESH duration per view
- Time between last write and REFRESH (staleness window)

---

### Phase 3: Trigger-Based Sync

Replace materialized views with real denormalized tables and PostgreSQL triggers that keep them in sync on every write.

**Step 1: Create Read Tables**

```sql
-- Drop materialized views
DROP MATERIALIZED VIEW IF EXISTS mv_revenue_by_region;
DROP MATERIALIZED VIEW IF EXISTS mv_top_products;
DROP MATERIALIZED VIEW IF EXISTS mv_user_spending;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_stats;

-- Revenue by region (denormalized table)
CREATE TABLE read_revenue_by_region (
    region VARCHAR(20) PRIMARY KEY,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Top products (denormalized table)
CREATE TABLE read_top_products (
    product_id INTEGER PRIMARY KEY,
    product_name VARCHAR(100),
    category VARCHAR(50),
    total_sold INTEGER DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User spending (denormalized table)
CREATE TABLE read_user_spending (
    user_id INTEGER PRIMARY KEY,
    user_name VARCHAR(100),
    region_code VARCHAR(10),
    tier VARCHAR(20),
    total_spent DECIMAL(14,2) DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    last_order_at TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily stats (denormalized table)
CREATE TABLE read_daily_stats (
    stat_date DATE PRIMARY KEY,
    order_count INTEGER DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    unique_customers INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    top_region VARCHAR(20),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Step 2: Create Trigger Functions**

```sql
-- Trigger: sync on order INSERT
CREATE OR REPLACE FUNCTION sync_read_models_on_order_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- Update revenue by region
    INSERT INTO read_revenue_by_region (region, total_revenue, order_count, avg_order_value)
    VALUES (NEW.region, NEW.total_amount, 1, NEW.total_amount)
    ON CONFLICT (region) DO UPDATE SET
        total_revenue = read_revenue_by_region.total_revenue + NEW.total_amount,
        order_count = read_revenue_by_region.order_count + 1,
        avg_order_value = (read_revenue_by_region.total_revenue + NEW.total_amount)
                        / (read_revenue_by_region.order_count + 1),
        last_updated = CURRENT_TIMESTAMP;

    -- Update user spending
    INSERT INTO read_user_spending (user_id, total_spent, order_count, avg_order_value, last_order_at)
    VALUES (NEW.user_id, NEW.total_amount, 1, NEW.total_amount, NEW.created_at)
    ON CONFLICT (user_id) DO UPDATE SET
        total_spent = read_user_spending.total_spent + NEW.total_amount,
        order_count = read_user_spending.order_count + 1,
        avg_order_value = (read_user_spending.total_spent + NEW.total_amount)
                        / (read_user_spending.order_count + 1),
        last_order_at = GREATEST(read_user_spending.last_order_at, NEW.created_at),
        last_updated = CURRENT_TIMESTAMP;

    -- Update daily stats
    INSERT INTO read_daily_stats (stat_date, order_count, total_revenue, unique_customers, avg_order_value)
    VALUES (DATE(NEW.created_at), 1, NEW.total_amount, 1, NEW.total_amount)
    ON CONFLICT (stat_date) DO UPDATE SET
        order_count = read_daily_stats.order_count + 1,
        total_revenue = read_daily_stats.total_revenue + NEW.total_amount,
        avg_order_value = (read_daily_stats.total_revenue + NEW.total_amount)
                        / (read_daily_stats.order_count + 1),
        last_updated = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: sync on order_items INSERT (for product tracking)
CREATE OR REPLACE FUNCTION sync_read_models_on_item_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_product_name VARCHAR(100);
    v_category VARCHAR(50);
BEGIN
    SELECT name, category INTO v_product_name, v_category
    FROM products WHERE id = NEW.product_id;

    INSERT INTO read_top_products (product_id, product_name, category, total_sold, total_revenue)
    VALUES (NEW.product_id, v_product_name, v_category, NEW.quantity, NEW.line_total)
    ON CONFLICT (product_id) DO UPDATE SET
        total_sold = read_top_products.total_sold + NEW.quantity,
        total_revenue = read_top_products.total_revenue + NEW.line_total,
        last_updated = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers
CREATE TRIGGER trg_order_insert_sync
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sync_read_models_on_order_insert();

CREATE TRIGGER trg_item_insert_sync
    AFTER INSERT ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION sync_read_models_on_item_insert();
```

**Step 3: Backfill Read Tables from Existing Data**

```sql
-- Populate read_revenue_by_region from current data
INSERT INTO read_revenue_by_region (region, total_revenue, order_count, avg_order_value)
SELECT
    region,
    SUM(total_amount),
    COUNT(*),
    AVG(total_amount)
FROM orders
WHERE status != 'cancelled'
GROUP BY region
ON CONFLICT (region) DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,
    order_count = EXCLUDED.order_count,
    avg_order_value = EXCLUDED.avg_order_value,
    last_updated = CURRENT_TIMESTAMP;

-- Similar backfills for other read tables...
```

**Metrics to Capture:**
- Read query time (same as mat views — fast)
- Write latency: INSERT with triggers vs without
- Write amplification: extra statements per INSERT
- Consistency: insert and immediately read — should be reflected

---

### Phase 4: Async LISTEN/NOTIFY

Replace heavy trigger-based sync with lightweight notifications. A background Node.js worker listens for changes and batch-updates read models asynchronously.

**Step 1: Replace Triggers with NOTIFY**

```sql
-- Drop sync triggers
DROP TRIGGER IF EXISTS trg_order_insert_sync ON orders;
DROP TRIGGER IF EXISTS trg_item_insert_sync ON order_items;

-- Lightweight NOTIFY trigger on orders
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('order_changes', json_build_object(
        'op', TG_OP,
        'id', NEW.id,
        'user_id', NEW.user_id,
        'region', NEW.region,
        'total_amount', NEW.total_amount,
        'status', NEW.status,
        'created_at', NEW.created_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_notify
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION notify_order_change();

-- Lightweight NOTIFY trigger on order_items
CREATE OR REPLACE FUNCTION notify_item_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('item_changes', json_build_object(
        'op', TG_OP,
        'id', NEW.id,
        'order_id', NEW.order_id,
        'product_id', NEW.product_id,
        'quantity', NEW.quantity,
        'line_total', NEW.line_total
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_notify
    AFTER INSERT ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION notify_item_change();
```

**Step 2: Background Worker (sync-worker.js)**

```javascript
// Listens for PostgreSQL notifications and batch-updates read models
//
// Usage: node sync-worker.js [batch_interval_ms]
// Default: batch every 500ms
//
// Workflow:
// 1. Connect to PostgreSQL
// 2. LISTEN order_changes
// 3. LISTEN item_changes
// 4. Collect notifications in memory buffer
// 5. Every batch_interval_ms, flush buffer:
//    - Aggregate order changes by region → UPDATE read_revenue_by_region
//    - Aggregate item changes by product → UPDATE read_top_products
//    - Aggregate order changes by user → UPDATE read_user_spending
//    - Aggregate order changes by date → UPDATE read_daily_stats
// 6. Log: batch size, flush duration, total processed
// 7. Graceful shutdown on SIGINT/SIGTERM
```

**Metrics to Capture:**
- Write latency: INSERT with NOTIFY vs baseline (minimal overhead)
- Sync lag: time between INSERT and read model update
- Batch efficiency: events per flush, flush duration
- Consistency check: insert, wait for flush, verify read model

---

## Table Designs

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     WRITE-SIDE TABLE RELATIONSHIPS                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐         ┌──────────────────┐                         │
│   │   products   │         │      users       │                         │
│   ├──────────────┤         ├──────────────────┤                         │
│   │ id (PK)      │         │ id (PK)          │                         │
│   │ name         │         │ email (UNIQUE)   │                         │
│   │ category     │         │ name             │                         │
│   │ price        │         │ region_code      │                         │
│   │ created_at   │         │ tier             │                         │
│   └──────┬───────┘         │ created_at       │                         │
│          │                 └────────┬─────────┘                         │
│          │                          │                                   │
│          │ FK: product_id           │ FK: user_id                       │
│          │                          │                                   │
│   ┌──────▼──────────────────────────▼─────────┐                         │
│   │              orders                        │                         │
│   ├────────────────────────────────────────────┤                         │
│   │ id (PK, BIGSERIAL)                         │                         │
│   │ user_id (FK → users.id)                    │                         │
│   │ region                                      │                         │
│   │ status                                      │                         │
│   │ total_amount                                │                         │
│   │ created_at                                  │                         │
│   │ updated_at                                  │                         │
│   └────────────────────┬───────────────────────┘                         │
│                        │                                                │
│                        │ FK: order_id                                   │
│                        │                                                │
│              ┌─────────▼──────────────┐                                  │
│              │      order_items       │                                  │
│              ├────────────────────────┤                                  │
│              │ id (PK, BIGSERIAL)     │                                  │
│              │ order_id (FK → orders) │                                  │
│              │ product_id (FK → prod) │                                  │
│              │ quantity               │                                  │
│              │ unit_price             │                                  │
│              │ line_total             │                                  │
│              └────────────────────────┘                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Read-Side Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    READ MODEL DATA FLOW                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   orders INSERT ──────────┬──────────────┬──────────────┐               │
│                           │              │              │               │
│                           ▼              ▼              ▼               │
│              ┌────────────────┐ ┌────────────┐ ┌──────────────┐        │
│              │ read_revenue_  │ │ read_user_ │ │ read_daily_  │        │
│              │ by_region      │ │ spending   │ │ stats        │        │
│              │                │ │            │ │              │        │
│              │ Aggregates:    │ │ Per-user:  │ │ Per-day:     │        │
│              │ SUM(amount)    │ │ SUM(spent) │ │ COUNT(orders)│        │
│              │ COUNT(orders)  │ │ COUNT(ord) │ │ SUM(revenue) │        │
│              │ AVG(value)     │ │ AVG(value) │ │ AVG(value)   │        │
│              └────────────────┘ └────────────┘ └──────────────┘        │
│                                                                          │
│   order_items INSERT ──────────────────┐                                │
│                                        ▼                                │
│                           ┌────────────────────┐                        │
│                           │  read_top_products  │                        │
│                           │                     │                        │
│                           │  Per-product:       │                        │
│                           │  SUM(qty_sold)      │                        │
│                           │  SUM(revenue)       │                        │
│                           └────────────────────┘                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## package.json

```json
{
  "name": "postgresql-cqrs-demo",
  "version": "1.0.0",
  "description": "PostgreSQL CQRS — E-Commerce Order Analytics with 3 sync strategies",
  "scripts": {
    "setup": "node setup-database.js",
    "load": "node load-data.js",
    "demo": "node demonstrate-queries.js",
    "worker": "node sync-worker.js",

    "phase1": "npm run setup && npm run demo",
    "phase2": "node sync-models.js mat-views && npm run demo",
    "phase3": "node sync-models.js triggers && npm run demo",
    "phase4": "node sync-models.js notify && npm run demo",

    "mat-views": "node sync-models.js mat-views",
    "triggers": "node sync-models.js triggers",
    "notify": "node sync-models.js notify",
    "refresh": "node sync-models.js refresh",

    "all": "npm run phase1 && npm run phase2 && npm run phase3 && npm run phase4"
  },
  "keywords": ["postgresql", "cqrs", "materialized-views", "triggers", "listen-notify"],
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

Initializes the database with the write-side schema and seeds data (Phase 1).

```javascript
// Usage: node setup-database.js
// - Connects to PostgreSQL (port 5450)
// - Creates write-side tables (users, products, orders, order_items)
// - Seeds reference data (products, regions)
// - Seeds 5,000 users across 10 regions
// - Seeds 100,000 orders with Pareto hot-user distribution
// - Seeds ~250,000 order items
// - Displays summary statistics
```

### sync-models.js

Orchestrates sync strategy transitions (Phase 2-4).

```javascript
// Usage: node sync-models.js <strategy>
// Strategies:
//   mat-views   - Phase 2: Create materialized views
//   refresh     - Phase 2: Refresh all materialized views
//   triggers    - Phase 3: Drop mat views, create read tables + triggers
//   notify      - Phase 4: Replace triggers with NOTIFY + read tables
//
// Each strategy:
// 1. Prints phase header with visual separator (═)
// 2. Checks current state (mat views exist? triggers exist?)
// 3. Cleans up previous strategy artifacts
// 4. Executes numbered SQL files
// 5. Displays read model statistics
// 6. Prints completion message with next-step hint
```

### demonstrate-queries.js

Runs analytics queries against both normalized tables and read models, with timing comparison.

```javascript
// Usage: node demonstrate-queries.js
// - Detects current phase (no read models / mat views / read tables)
// - Runs dashboard queries (revenue, top products, daily stats)
// - Runs user analytics queries (top spenders, by tier)
// - Runs write performance benchmark (insert 1000 orders)
// - Runs freshness check (insert + immediate read)
// - Collects all results in queryResults[]
// - Prints summary comparison table:
//   | # | Query | Baseline (ms) | Read Model (ms) | Speedup |
```

### load-data.js

Continuously generates orders to simulate production write traffic.

```javascript
// Usage: node load-data.js [interval_ms] [duration_sec]
// Example: node load-data.js 50 120
// - Generates orders with Pareto hot-user distribution
// - Each order gets 1-5 order items
// - Tracks insert rate and total inserts
// - Graceful shutdown on SIGINT
```

### sync-worker.js

Background worker for Phase 4 (LISTEN/NOTIFY).

```javascript
// Usage: node sync-worker.js [batch_interval_ms]
// Default batch interval: 500ms
// - Connects and issues LISTEN order_changes, LISTEN item_changes
// - Buffers notifications in memory
// - Flushes buffer every batch_interval_ms
// - Aggregates changes efficiently before writing to read tables
// - Logs: batch size, flush duration, total events processed
// - Graceful shutdown on SIGINT/SIGTERM
```

---

## Execution Flow

### Quick Start

```bash
# Install dependencies & start database
npm install
docker-compose up -d

# Run all 4 phases automatically
npm run all

# Or run phases individually
npm run phase1    # Baseline (normalized queries)
npm run phase2    # Materialized views
npm run phase3    # Trigger-based sync
npm run phase4    # LISTEN/NOTIFY (start worker separately)
```

### Phase-by-Phase Execution

| Phase | npm Script | What It Does |
|-------|------------|--------------|
| **1** | `npm run phase1` | Create tables, seed 100K orders, run baseline analytics |
| **1** | `npm run load` | (Optional) Generate more orders |
| **2** | `npm run phase2` | Create 4 materialized views, run same analytics (faster) |
| **2** | `npm run refresh` | (Optional) Manually refresh views |
| **3** | `npm run phase3` | Drop mat views, create read tables + triggers, run analytics |
| **4** | `npm run phase4` | Replace triggers with NOTIFY, run analytics |
| **4** | `npm run worker` | (Separate terminal) Start async sync worker |

### What to Observe at Each Phase

**Phase 1 (Baseline):**
```bash
npm run demo
# EXPLAIN shows: Hash Join, Seq Scan on orders + order_items
# Dashboard queries: 50-200ms (depending on data size)
# JOINs dominate execution time
```

**Phase 2 (Materialized Views):**
```bash
npm run demo
# Same analytics, now: Seq Scan on mv_revenue_by_region
# Dashboard queries: 1-5ms (pre-computed)
# REFRESH MATERIALIZED VIEW: 200-500ms per view
# Stale data visible if writes happened after last REFRESH
```

**Phase 3 (Triggers):**
```bash
npm run demo
# Dashboard queries: 1-5ms (same as mat views — denormalized tables)
# Write benchmark: INSERT is 2-3x slower (trigger overhead)
# Freshness check: always up-to-date (same transaction)
```

**Phase 4 (LISTEN/NOTIFY):**
```bash
# Terminal 1: Start the sync worker
npm run worker

# Terminal 2: Run demo
npm run demo
# Write benchmark: INSERT nearly as fast as baseline (just NOTIFY)
# Freshness check: may be stale by batch_interval_ms
# Worker logs show: batch sizes, flush timing
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

### Read Model Status

```sql
-- Check which sync strategy is currently active
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname LIKE 'mv_%')
        THEN 'materialized_views'
        WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_%_sync')
        THEN 'triggers'
        WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_%_notify')
        THEN 'listen_notify'
        ELSE 'none (baseline)'
    END AS current_strategy;
```

### Read Model Freshness

```sql
-- Check when each read model was last updated
SELECT 'read_revenue_by_region' AS model,
       COUNT(*) AS rows,
       MAX(last_updated) AS last_refreshed,
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER AS staleness_sec
FROM read_revenue_by_region
UNION ALL
SELECT 'read_top_products', COUNT(*), MAX(last_updated),
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER
FROM read_top_products
UNION ALL
SELECT 'read_user_spending', COUNT(*), MAX(last_updated),
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER
FROM read_user_spending
UNION ALL
SELECT 'read_daily_stats', COUNT(*), MAX(last_updated),
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_updated)))::INTEGER
FROM read_daily_stats;
```

### Write Side Statistics

```sql
-- Write-side data volume
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
ORDER BY table_name;

-- Hot user distribution
SELECT user_id, COUNT(*) AS order_count
FROM orders
GROUP BY user_id
ORDER BY order_count DESC
LIMIT 10;
```

### Trigger Status

```sql
-- List all active triggers on orders/order_items
SELECT
    t.tgname AS trigger_name,
    c.relname AS table_name,
    p.proname AS function_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'enabled'
        WHEN 'D' THEN 'disabled'
    END AS status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname IN ('orders', 'order_items')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

---

## Docker Configuration

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: cqrs-demo-db
    ports:
      - "5450:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-cqrs_demo}
    volumes:
      - ./data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### .env.example

```bash
# Database connection
POSTGRES_HOST=localhost
POSTGRES_PORT=5450
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=cqrs_demo

# Data generation
SEED_USERS=5000
SEED_ORDERS=100000
HOT_USER_PERCENTAGE=20

# Sync worker (Phase 4)
BATCH_INTERVAL_MS=500
```

---

## Success Criteria

### Phase 1: Baseline
- [ ] Tables created (users, products, orders, order_items)
- [ ] 5,000 users seeded across 10 regions
- [ ] 100,000 orders with Pareto distribution
- [ ] ~250,000 order items generated
- [ ] Baseline analytics queries return correct results
- [ ] Query durations captured for comparison

### Phase 2: Materialized Views
- [ ] 4 materialized views created with unique indexes
- [ ] REFRESH MATERIALIZED VIEW CONCURRENTLY works
- [ ] Read queries are 10-100x faster than baseline
- [ ] Staleness demonstrated: insert → query → stale → refresh → fresh
- [ ] Refresh duration measured

### Phase 3: Trigger-Based Sync
- [ ] Materialized views dropped cleanly
- [ ] 4 read tables created and backfilled
- [ ] Trigger functions fire on INSERT/UPDATE
- [ ] Read queries as fast as mat views
- [ ] Write overhead measured (INSERT with triggers vs without)
- [ ] Freshness verified: insert → immediate read → reflected

### Phase 4: Async LISTEN/NOTIFY
- [ ] Sync triggers replaced with NOTIFY triggers
- [ ] sync-worker.js connects and receives notifications
- [ ] Batch updates work correctly (aggregation + flush)
- [ ] Write overhead minimal (just NOTIFY)
- [ ] Sync lag measurable (insert → wait → query → check)
- [ ] Graceful shutdown preserves pending changes

---

## Educational Demonstrations

### Demo 1: The CQRS Problem — Why JOINs Don't Scale

```sql
-- As data grows, this query gets progressively slower
EXPLAIN (ANALYZE, BUFFERS)
SELECT
    u.tier,
    COUNT(DISTINCT u.id) AS user_count,
    COUNT(o.id) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS avg_order_value
FROM users u
JOIN orders o ON u.id = o.user_id
JOIN order_items oi ON o.id = oi.order_id
WHERE o.status != 'cancelled'
GROUP BY u.tier
ORDER BY total_revenue DESC;

-- Observe: Hash Join, Seq Scan, large row estimates
-- Compare with: SELECT * FROM read_revenue_by_region (instant)
```

### Demo 2: Materialized View Staleness Window

```sql
-- Step 1: Check current revenue for US-EAST
SELECT total_revenue FROM mv_revenue_by_region WHERE region = 'US-EAST';

-- Step 2: Insert a large order
INSERT INTO orders (user_id, region, status, total_amount)
VALUES (1, 'US-EAST', 'completed', 99999.99);

-- Step 3: Query again — STALE (old value)
SELECT total_revenue FROM mv_revenue_by_region WHERE region = 'US-EAST';

-- Step 4: Refresh
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_by_region;

-- Step 5: Query again — FRESH (new value)
SELECT total_revenue FROM mv_revenue_by_region WHERE region = 'US-EAST';
```

### Demo 3: Trigger Write Amplification

```sql
-- Measure: INSERT 1000 orders WITHOUT triggers
-- Time: ~X ms

-- Measure: INSERT 1000 orders WITH triggers (4 read model updates each)
-- Time: ~Y ms

-- Write amplification factor: Y / X
-- Each INSERT triggers: 1 write to read_revenue_by_region
--                       1 write to read_user_spending
--                       1 write to read_daily_stats
--                       (+ 1 write to read_top_products per order_item)
```

### Demo 4: LISTEN/NOTIFY Consistency Lag

```javascript
// Step 1: Insert order
// Step 2: Immediately query read model → may be stale
// Step 3: Wait batch_interval_ms
// Step 4: Query again → should be fresh
// Measure: time between insert and read model update
```

### Demo 5: Comparing All Strategies Side by Side

```
═══════════════════════════════════════════════════════
PERFORMANCE COMPARISON ACROSS SYNC STRATEGIES
═══════════════════════════════════════════════════════

Query: Revenue by Region (Top 10)
─────────────────────────────────
  Baseline (JOINs):       87.3 ms
  Materialized Views:      1.2 ms  (72x faster)
  Trigger Read Tables:     1.1 ms  (79x faster)
  NOTIFY Read Tables:      1.1 ms  (79x faster)

Write: Insert 1000 Orders
─────────────────────────
  Baseline (no sync):    450 ms
  Mat Views (no sync):   450 ms  (no overhead)
  Triggers:             1200 ms  (2.7x slower)
  NOTIFY:                480 ms  (1.07x slower)

Freshness After Insert
──────────────────────
  Baseline:            instant
  Mat Views:          stale until REFRESH (~300ms)
  Triggers:           instant
  NOTIFY:             ~500ms (batch interval)
```

---

## Next Steps

After completing this demo:

1. **Event Sourcing + CQRS** — Module 06: append-only event store with projections (banking ledger)
2. **Debezium CDC** — Replace LISTEN/NOTIFY with WAL-based change data capture
3. **Redis read models** — Move read models to Redis for sub-millisecond reads
4. **Multiple read databases** — Replicate read models to a read replica
5. **GraphQL subscriptions** — Real-time dashboard updates via WebSocket
