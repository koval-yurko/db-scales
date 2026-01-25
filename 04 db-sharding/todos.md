# PostgreSQL Sharding with Citus - Implementation Checklist

## Infrastructure Setup

- [x] Create Dockerfile (PostgreSQL 16 + Citus)
- [x] Create docker-compose.yml (coordinator + 3 workers)
- [x] Create .env.example with environment variables
- [x] Create package.json with npm scripts
- [x] Test cluster startup (`docker-compose up -d --build`)

## Utility Scripts (utils/)

- [x] Create utils/config.js - Environment configuration
- [x] Create utils/sql-runner.js - Execute SQL files
- [x] Create utils/data-generator.js - Generate test records
- [x] Create utils/shard-stats.js - Display distribution statistics

## Phase 1: Regular Table (Baseline)

### SQL Scripts
- [x] Create scripts/setup/00_create_base_table.sql
  - [x] orders table (id, user_id, region, product_id, quantity, amount, status, metadata, created_at, updated_at)
  - [x] users table (id, email, name, region_code, tier, created_at)
  - [x] regions table (code, name, timezone, currency)
  - [x] order_items table (id, user_id, order_id, product_name, quantity, unit_price)
  - [x] Indexes (idx_orders_user_id, idx_orders_region, idx_orders_created_at)
- [x] Create scripts/setup/01_initial_seed_data.sql
  - [x] Insert 10 regions
  - [x] Insert 1,000 users across regions
  - [x] Insert 10,000 orders (20% users generate 80% orders)

### Node.js Scripts
- [x] Create setup-database.js - Initialize database with base tables
- [x] Create load-data.js - Continuous data generator

### Verification
- [x] Tables created successfully
- [x] 10,000+ orders seeded
- [x] Citus extension NOT created yet
- [x] Baseline queries work correctly

## Phase 2: Distribute Table

### SQL Scripts
- [x] Create scripts/sharding/10_enable_citus.sql
  - [x] CREATE EXTENSION IF NOT EXISTS citus
  - [x] Verify with citus_version()
- [x] Create scripts/sharding/11_add_workers.sql
  - [x] Register worker1 (citus_add_node)
  - [x] Register worker2 (citus_add_node)
  - [x] Verify with citus_get_active_worker_nodes()
- [x] Create scripts/sharding/12_distribute_table.sql
  - [x] create_distributed_table('orders', 'user_id')
  - [x] create_distributed_table('order_items', 'user_id', colocate_with => 'orders')
- [x] Create scripts/sharding/13_create_reference_table.sql
  - [x] create_reference_table('regions')
- [x] Create scripts/sharding/14_verify_distribution.sql
  - [x] Check pg_dist_partition
  - [x] View shard locations
  - [x] Count shards per worker

### Node.js Scripts
- [x] Create reshard.js with `enable-citus` scenario

### Verification
- [x] Citus extension enabled
- [x] Workers registered and healthy
- [x] Tables distributed across workers
- [x] Shards visible in citus_shards
- [x] EXPLAIN shows distributed execution

## Phase 3: Resharding

### SQL Scripts
- [x] Create scripts/resharding/30_add_worker_node.sql
  - [x] Register worker3
  - [x] Verify new node
- [x] Create scripts/resharding/31_rebalance_shards.sql
  - [x] Check current distribution
  - [x] rebalance_table_shards()
  - [x] Monitor rebalance progress
- [x] Create scripts/resharding/32_isolate_tenant.sql
  - [x] get_shard_id_for_distribution_column
  - [x] isolate_tenant_to_new_shard
  - [x] Verify isolation
- [x] Create scripts/resharding/33_drain_worker.sql
  - [x] citus_drain_node
  - [x] Monitor progress
  - [x] citus_remove_node
- [x] Create scripts/resharding/34_undistribute_table.sql
  - [x] undistribute_table('orders')
  - [x] undistribute_table('regions')
  - [x] Verify regular table

### Node.js Scripts
- [x] Add `add-worker` scenario to reshard.js
- [x] Add `rebalance` scenario to reshard.js
- [x] Add `isolate` scenario to reshard.js
- [x] Add `drain` scenario to reshard.js

### Verification
- [x] Third worker added successfully
- [x] Shards rebalanced across 3 workers
- [x] Tenant isolation works
- [x] Worker drain completes without data loss

## Phase 4: Undistribute (Consolidate)

### Node.js Scripts
- [x] Add `undistribute` scenario to reshard.js

### Verification
- [x] Table converted to regular PostgreSQL
- [x] All data consolidated on coordinator
- [x] Queries work on regular table
- [x] citus_tables returns empty

## Query Demonstration Scripts

### SQL Scripts
- [x] Create scripts/queries/20_single_shard_query.sql
  - [x] SELECT * FROM orders WHERE user_id = X
  - [x] EXPLAIN ANALYZE
- [x] Create scripts/queries/21_cross_shard_query.sql
  - [x] Aggregations across all shards
  - [x] EXPLAIN ANALYZE
- [x] Create scripts/queries/22_join_queries.sql
  - [x] Reference table joins
  - [x] Colocated joins
  - [x] Cross-shard joins
- [x] Create scripts/queries/23_explain_analyze.sql
  - [x] Router executor examples
  - [x] Adaptive executor examples
- [x] Create scripts/queries/24_distribution_stats.sql
  - [x] Shards per worker
  - [x] Row distribution
  - [x] Shard sizes

### Node.js Scripts
- [x] Create demonstrate-queries.js
  - [x] single-shard query type
  - [x] cross-shard query type
  - [x] join query type
  - [x] aggregate query type
  - [x] all query types

## Documentation

- [x] Create README.md with quick start guide
- [ ] Verify all npm scripts work:
  - [ ] `npm run setup`
  - [ ] `npm run load`
  - [ ] `npm run demo`
  - [ ] `npm run phase1`
  - [ ] `npm run phase2`
  - [ ] `npm run phase3`
  - [ ] `npm run phase4`
  - [ ] `npm run all`

## Testing & Validation

- [x] Run full demo cycle (`npm run all`)
- [x] Verify data integrity after each phase
- [x] Test queries return correct results at each phase
- [ ] Capture performance metrics for comparison
