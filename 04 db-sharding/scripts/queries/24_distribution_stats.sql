-- Distribution Statistics
-- Monitor shard distribution, sizes, and cluster health

-- ============================================
-- 1. CLUSTER OVERVIEW
-- ============================================

-- Citus version
SELECT citus_version();

-- Active worker nodes
SELECT * FROM citus_get_active_worker_nodes();

-- All nodes (including inactive)
SELECT
    nodeid,
    nodename,
    nodeport,
    isactive,
    noderole,
    shouldhaveshards
FROM pg_dist_node
ORDER BY nodeid;

-- ============================================
-- 2. DISTRIBUTED TABLES
-- ============================================

-- All distributed and reference tables
SELECT
    logicalrelid::text AS table_name,
    CASE partmethod
        WHEN 'h' THEN 'distributed (hash)'
        WHEN 'n' THEN 'reference'
        WHEN 'a' THEN 'distributed (append)'
        ELSE partmethod
    END AS table_type,
    partkey::text AS distribution_column,
    colocationid,
    repmodel
FROM pg_dist_partition
ORDER BY table_name;

-- Shard counts per table
SELECT
    logicalrelid::text AS table_name,
    COUNT(*) as shard_count
FROM pg_dist_shard
GROUP BY logicalrelid
ORDER BY table_name;

-- ============================================
-- 3. SHARD DISTRIBUTION BY WORKER
-- ============================================

-- Shards per worker with sizes
SELECT
    nodename,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size,
    pg_size_pretty(AVG(shard_size)::bigint) as avg_shard_size
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

-- Shards per worker per table
SELECT
    nodename,
    table_name::text,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size
FROM citus_shards
GROUP BY nodename, table_name
ORDER BY nodename, table_name;

-- ============================================
-- 4. SHARD DETAILS
-- ============================================

-- Detailed shard information
SELECT
    shardid,
    table_name::text,
    nodename,
    nodeport,
    pg_size_pretty(shard_size) as size,
    shardminvalue,
    shardmaxvalue
FROM citus_shards
ORDER BY table_name, shardid
LIMIT 50;

-- Find shard for specific value
SELECT get_shard_id_for_distribution_column('orders', 42) as shard_for_user_42;
SELECT get_shard_id_for_distribution_column('orders', 1) as shard_for_user_1;

-- ============================================
-- 5. COLOCATION GROUPS
-- ============================================

-- Tables that are colocated together
SELECT
    colocationid,
    array_agg(logicalrelid::text ORDER BY logicalrelid) as colocated_tables,
    COUNT(*) as table_count
FROM pg_dist_partition
WHERE colocationid > 0
GROUP BY colocationid
ORDER BY colocationid;

-- ============================================
-- 6. DATA DISTRIBUTION ANALYSIS
-- ============================================

-- Row count approximation per shard (sample)
-- Note: This queries actual shard tables
SELECT
    'orders' as table_name,
    nodename,
    COUNT(*) as shard_count,
    SUM(shard_size) as total_bytes
FROM citus_shards
WHERE table_name = 'orders'::regclass
GROUP BY nodename;

-- ============================================
-- 7. CLUSTER HEALTH
-- ============================================

-- Check cluster health
SELECT * FROM citus_check_cluster_node_health();

-- Active connections per node
SELECT
    nodename,
    COUNT(*) as connections
FROM citus_stat_activity
GROUP BY nodename
ORDER BY nodename;

-- ============================================
-- 8. REBALANCE STATUS
-- ============================================

-- Check if rebalance is in progress
SELECT * FROM citus_rebalance_status();

-- Background job status
SELECT * FROM citus_rebalance_status()
WHERE NOT job_completed;
