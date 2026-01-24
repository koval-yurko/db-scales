-- Phase 2: Verify Distribution
-- Check that tables are properly distributed across workers

-- 1. All distributed/reference tables
SELECT
    logicalrelid::text AS table_name,
    CASE partmethod
        WHEN 'h' THEN 'hash (distributed)'
        WHEN 'n' THEN 'none (reference)'
        ELSE partmethod
    END AS type,
    partkey::text AS distribution_column,
    colocationid,
    (SELECT COUNT(*) FROM pg_dist_shard WHERE logicalrelid = t.logicalrelid) as shard_count
FROM pg_dist_partition t
ORDER BY table_name;

-- 2. Shard count per worker
SELECT
    nodename,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

-- 3. Sample shard placement details
SELECT
    shardid,
    table_name::text,
    nodename,
    nodeport,
    pg_size_pretty(shard_size) as size
FROM citus_shards
ORDER BY table_name, shardid
LIMIT 20;

-- 4. Colocation groups
SELECT
    colocationid,
    array_agg(logicalrelid::text ORDER BY logicalrelid) as tables
FROM pg_dist_partition
WHERE colocationid > 0
GROUP BY colocationid
ORDER BY colocationid;

-- 5. Total row counts
SELECT 'orders' as table_name, COUNT(*) as row_count FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL
SELECT 'regions', COUNT(*) FROM regions
UNION ALL
SELECT 'users', COUNT(*) FROM users;
