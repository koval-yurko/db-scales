-- =============================================================================
-- 20_range_queries.sql
-- Example queries demonstrating RANGE partition pruning on event_logs
-- Table: event_logs (partitioned by RANGE on created_at)
-- =============================================================================

-- Query 1: Single month query - scans only one partition
-- Expected: Only event_logs_2024_01 is scanned
SELECT 'Query 1: Events in January 2024 (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, created_at
FROM event_logs
WHERE created_at >= '2024-01-01' AND created_at < '2024-02-01';

-- Query 2: Specific date range within one partition
-- Expected: Only event_logs_2024_02 is scanned
SELECT 'Query 2: Events from Feb 10-20 (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, created_at
FROM event_logs
WHERE created_at >= '2024-02-10' AND created_at < '2024-02-20';

-- Query 3: Cross-partition query spanning two months
-- Expected: event_logs_2024_01 and event_logs_2024_02 are scanned
SELECT 'Query 3: Events from Jan 15 to Feb 15 (two partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, created_at
FROM event_logs
WHERE created_at >= '2024-01-15' AND created_at < '2024-02-15';

-- Query 4: Full quarter query
-- Expected: All Q1 partitions scanned (Jan, Feb, Mar)
SELECT 'Query 4: All Q1 2024 events (three partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, created_at
FROM event_logs
WHERE created_at >= '2024-01-01' AND created_at < '2024-04-01';

-- Query 5: Query with additional filter (event_type)
-- Expected: Partition pruning + index usage on event_type
SELECT 'Query 5: Error events in February (partition + index)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, payload, created_at
FROM event_logs
WHERE created_at >= '2024-02-01' AND created_at < '2024-03-01'
  AND event_type = 'error';

-- Query 6: Aggregate query with partition pruning
-- Expected: Count only scans relevant partition
SELECT 'Query 6: Count events per type in March' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT event_type, COUNT(*) as event_count
FROM event_logs
WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01'
GROUP BY event_type;

-- Query 7: Query hitting default partition
-- Expected: Only default partition scanned (dates outside defined ranges)
SELECT 'Query 7: Events in December 2024 (default partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, created_at
FROM event_logs
WHERE created_at >= '2024-12-01' AND created_at < '2025-01-01';

-- Query 8: ORDER BY with LIMIT on partitioned table
-- Expected: Efficient merge of sorted results from pruned partitions
SELECT 'Query 8: Latest 10 events in February' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, event_type, created_at
FROM event_logs
WHERE created_at >= '2024-02-01' AND created_at < '2024-03-01'
ORDER BY created_at DESC
LIMIT 10;

-- Summary of partition pruning effectiveness
SELECT 'RANGE Partitioning Summary' AS info;
SELECT
    'event_logs' AS table_name,
    'RANGE on created_at' AS partition_strategy,
    'Monthly partitions (2024_01, 2024_02, 2024_03, default)' AS partitions,
    'Date range queries eliminate irrelevant partitions' AS pruning_benefit;
