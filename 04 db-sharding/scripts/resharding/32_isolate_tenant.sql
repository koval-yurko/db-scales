-- Phase 3: Isolate Hot Tenant
-- Move a high-traffic user to their own dedicated shard

-- Find the busiest user (most orders)
SELECT user_id, COUNT(*) as order_count
FROM orders
GROUP BY user_id
ORDER BY order_count DESC
LIMIT 5;

-- Check which shard contains user 1 (our hot user)
SELECT get_shard_id_for_distribution_column('orders', 1);

-- View current shard details for that user's shard
SELECT
    cs.shardid,
    cs.nodename,
    pds.shardminvalue,
    pds.shardmaxvalue
FROM citus_shards cs
JOIN pg_dist_shard pds ON cs.shardid = pds.shardid
WHERE cs.table_name = 'orders'::regclass
AND cs.shardid = (SELECT get_shard_id_for_distribution_column('orders', 1));

-- Isolate user 1 to their own dedicated shard
-- This splits the shard and moves user 1's data to a new shard
-- Use CASCADE to handle colocated tables (order_items)
SELECT isolate_tenant_to_new_shard('orders', 1, 'CASCADE');

-- Verify isolation - user 1 should now have their own shard
SELECT
    cs.shardid,
    cs.nodename,
    pds.shardminvalue,
    pds.shardmaxvalue
FROM citus_shards cs
JOIN pg_dist_shard pds ON cs.shardid = pds.shardid
WHERE cs.table_name = 'orders'::regclass
ORDER BY pds.shardminvalue::bigint;

-- The colocated order_items table is automatically handled
SELECT
    cs.shardid,
    cs.nodename,
    pds.shardminvalue,
    pds.shardmaxvalue
FROM citus_shards cs
JOIN pg_dist_shard pds ON cs.shardid = pds.shardid
WHERE cs.table_name = 'order_items'::regclass
ORDER BY pds.shardminvalue::bigint;
