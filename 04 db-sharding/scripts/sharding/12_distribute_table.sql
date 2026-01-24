-- Phase 2: Distribute Tables
-- Convert existing PostgreSQL tables to distributed tables

-- Before distributing, we need to modify the primary key to include the distribution column
-- This is required for distributed tables in Citus

-- Step 1: Modify orders table primary key
ALTER TABLE orders DROP CONSTRAINT orders_pkey;
ALTER TABLE orders ADD PRIMARY KEY (user_id, id);

-- Step 2: Modify order_items table primary key
ALTER TABLE order_items DROP CONSTRAINT order_items_pkey;
ALTER TABLE order_items ADD PRIMARY KEY (user_id, id);

-- Step 3: Distribute orders table by user_id (creates 32 shards by default)
SELECT create_distributed_table('orders', 'user_id');

-- Step 4: Distribute order_items colocated with orders
-- Colocation ensures orders and order_items for the same user are on the same worker
SELECT create_distributed_table('order_items', 'user_id', colocate_with => 'orders');

-- Verify distribution
SELECT
    logicalrelid::text AS table_name,
    partmethod AS method,
    partkey::text AS distribution_column,
    colocationid
FROM pg_dist_partition
ORDER BY table_name;
