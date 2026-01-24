-- Phase 3: Drain Worker Node
-- Safely remove a worker by moving all its shards to other workers

-- Check current shard distribution
SELECT
    nodename,
    COUNT(*) as shard_count
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

-- Drain worker2 - moves all shards off this node
-- This is a blocking operation that moves data
SELECT citus_drain_node('worker2', 5432);

-- Monitor drain progress (run in separate session during drain)
-- SELECT * FROM citus_rebalance_status();

-- Verify worker2 has no shards
SELECT
    nodename,
    COUNT(*) as shard_count
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

-- Remove the drained node from the cluster
-- The container keeps running, but it's no longer part of the cluster
SELECT citus_remove_node('worker2', 5432);

-- Verify node is removed
SELECT * FROM citus_get_active_worker_nodes();

-- Note: To re-add the node later:
-- SELECT citus_add_node('worker2', 5432);
-- SELECT rebalance_table_shards();
