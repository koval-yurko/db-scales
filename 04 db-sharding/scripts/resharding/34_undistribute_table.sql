-- Phase 4: Undistribute Tables
-- Convert distributed tables back to regular PostgreSQL tables

-- Check current distributed tables
SELECT
    logicalrelid::text AS table_name,
    partmethod AS type,
    (SELECT COUNT(*) FROM pg_dist_shard WHERE logicalrelid = t.logicalrelid) as shard_count
FROM pg_dist_partition t
ORDER BY table_name;

-- Undistribute order_items first (due to colocation dependency)
SELECT undistribute_table('order_items');

-- Undistribute orders table
-- This consolidates all data back to the coordinator
SELECT undistribute_table('orders');

-- Undistribute regions reference table
SELECT undistribute_table('regions');

-- Verify tables are now regular PostgreSQL tables
SELECT
    logicalrelid::text AS table_name
FROM pg_dist_partition;
-- Should return 0 rows

-- Verify data is intact
SELECT 'orders' as table_name, COUNT(*) as row_count FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL
SELECT 'regions', COUNT(*) FROM regions
UNION ALL
SELECT 'users', COUNT(*) FROM users;

-- Tables are now regular PostgreSQL tables
-- Workers can be stopped if no longer needed
-- Citus extension can optionally be dropped:
-- DROP EXTENSION citus;
