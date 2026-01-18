-- =============================================================================
-- 21_hash_queries.sql
-- Example queries demonstrating HASH partition pruning on users_distributed
-- Table: users_distributed (partitioned by HASH on id)
-- =============================================================================

-- Query 1: Point lookup by exact ID - scans single partition
-- Expected: Only one of p0/p1/p2/p3 is scanned based on hash(id)
SELECT 'Query 1: Lookup user by exact ID (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, username, email, country_code
FROM users_distributed
WHERE id = 42;

-- Query 2: Another point lookup
-- Expected: Single partition scan (different partition than Query 1)
SELECT 'Query 2: Lookup another user by ID (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, username, email, country_code
FROM users_distributed
WHERE id = 123;

-- Query 3: IN clause with multiple IDs
-- Expected: Scans only partitions containing the specified IDs
SELECT 'Query 3: Multiple ID lookup with IN clause' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, username, email, country_code
FROM users_distributed
WHERE id IN (10, 50, 100, 150);

-- Query 4: Range query on ID - NO pruning possible
-- Expected: ALL partitions scanned (hash doesn't support range pruning)
SELECT 'Query 4: ID range query (all partitions - no pruning)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, username, email, country_code
FROM users_distributed
WHERE id BETWEEN 1 AND 100;

-- Query 5: Query by non-partition column - NO pruning
-- Expected: ALL partitions scanned (filtering on country_code, not id)
SELECT 'Query 5: Filter by country_code (all partitions - no pruning)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, username, email, country_code
FROM users_distributed
WHERE country_code = 'US';

-- Query 6: Exact ID with additional filter
-- Expected: Single partition + filter on country_code
SELECT 'Query 6: Exact ID with country filter (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, username, email, country_code
FROM users_distributed
WHERE id = 75 AND country_code = 'CA';

-- Query 7: Count per country (full scan required)
-- Expected: ALL partitions scanned for aggregation
SELECT 'Query 7: Count users by country (all partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT country_code, COUNT(*) as user_count
FROM users_distributed
GROUP BY country_code
ORDER BY user_count DESC;

-- Query 8: Verify even distribution across partitions
SELECT 'Query 8: Hash distribution verification' AS query_description;
SELECT 'p0' AS partition, COUNT(*) AS rows FROM users_distributed_p0
UNION ALL
SELECT 'p1', COUNT(*) FROM users_distributed_p1
UNION ALL
SELECT 'p2', COUNT(*) FROM users_distributed_p2
UNION ALL
SELECT 'p3', COUNT(*) FROM users_distributed_p3
ORDER BY partition;

-- Summary of hash partitioning characteristics
SELECT 'HASH Partitioning Summary' AS info;
SELECT
    'users_distributed' AS table_name,
    'HASH on id (4 partitions)' AS partition_strategy,
    'Even distribution for parallel processing' AS primary_benefit,
    'Only exact ID matches enable pruning' AS limitation;
