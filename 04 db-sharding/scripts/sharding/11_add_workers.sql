-- Phase 2: Register Worker Nodes with Coordinator
-- Workers use internal Docker network hostname and port 5432

-- Register worker1
SELECT citus_add_node('worker1', 5432);

-- Register worker2
SELECT citus_add_node('worker2', 5432);

-- Verify workers are registered and healthy
SELECT * FROM citus_get_active_worker_nodes();

-- Check node details
SELECT * FROM pg_dist_node ORDER BY nodeid;
