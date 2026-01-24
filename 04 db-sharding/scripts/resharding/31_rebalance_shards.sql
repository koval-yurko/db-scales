-- Phase 3: Rebalance Shards
-- Redistribute shards evenly across all workers (including newly added worker3)

-- Check current distribution before rebalance
SELECT
    nodename,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

-- Rebalance all distributed tables across all workers
-- This moves shards to achieve even distribution
SELECT rebalance_table_shards();

-- Alternative: Rebalance specific table only
-- SELECT rebalance_table_shards('orders');

-- Alternative: Rebalance by disk size instead of shard count
-- SELECT rebalance_table_shards(rebalance_strategy := 'by_disk_size');

-- Check distribution after rebalance
SELECT
    nodename,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

-- Verify shard placement for orders table
SELECT
    shardid,
    nodename,
    pg_size_pretty(shard_size) as size
FROM citus_shards
WHERE table_name = 'orders'::regclass
ORDER BY shardid;
