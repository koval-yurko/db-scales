-- Phase 3: Add Worker Node
-- Register worker3 with the cluster (container is already running)

-- Check current workers before adding
SELECT * FROM citus_get_active_worker_nodes();

-- Register worker3
SELECT citus_add_node('worker3', 5432);

-- Verify new node is registered
SELECT * FROM citus_get_active_worker_nodes();

-- Check node details
SELECT
    nodeid,
    nodename,
    nodeport,
    isactive,
    noderole
FROM pg_dist_node
ORDER BY nodeid;

-- Note: worker3 is now registered but has no shards yet
-- Run rebalance to distribute shards to the new worker
