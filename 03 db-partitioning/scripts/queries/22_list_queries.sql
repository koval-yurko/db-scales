-- =============================================================================
-- 22_list_queries.sql
-- Example queries demonstrating LIST partition pruning on orders_by_region
-- Table: orders_by_region (partitioned by LIST on region)
-- =============================================================================

-- Query 1: Single region query - scans one partition
-- Expected: Only orders_by_region_north_america is scanned
SELECT 'Query 1: North America orders (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, customer_name, region, order_total, status
FROM orders_by_region
WHERE region = 'north_america';

-- Query 2: Different region query
-- Expected: Only orders_by_region_europe is scanned
SELECT 'Query 2: Europe orders (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, customer_name, region, order_total, status
FROM orders_by_region
WHERE region = 'europe';

-- Query 3: Multiple regions with IN clause
-- Expected: Two partitions scanned (europe + asia_pacific)
SELECT 'Query 3: Europe and Asia Pacific orders (two partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, customer_name, region, order_total, status
FROM orders_by_region
WHERE region IN ('europe', 'asia_pacific');

-- Query 4: All regions except one
-- Expected: Three partitions scanned (excludes north_america)
SELECT 'Query 4: All except North America (three partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, customer_name, region, order_total, status
FROM orders_by_region
WHERE region != 'north_america';

-- Query 5: Region + status filter
-- Expected: Single partition + index on status
SELECT 'Query 5: Pending orders in Asia Pacific (single partition + filter)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, customer_name, region, order_total, status
FROM orders_by_region
WHERE region = 'asia_pacific' AND status = 'pending';

-- Query 6: Region + amount filter with aggregation
-- Expected: Single partition scan with filter and aggregation
SELECT 'Query 6: High-value Europe orders summary (single partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT
    status,
    COUNT(*) as order_count,
    SUM(order_total) as total_revenue,
    AVG(order_total) as avg_order
FROM orders_by_region
WHERE region = 'europe' AND order_total > 100
GROUP BY status;

-- Query 7: "Other" region (catch-all partition)
-- Expected: Only orders_by_region_other is scanned
SELECT 'Query 7: Other regions (default list partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, customer_name, region, order_total, status
FROM orders_by_region
WHERE region = 'south_america';

-- Query 8: Cross-region comparison query
-- Expected: Two partitions scanned
SELECT 'Query 8: Compare North America vs Europe totals' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT
    region,
    COUNT(*) as orders,
    SUM(order_total) as revenue
FROM orders_by_region
WHERE region IN ('north_america', 'europe')
GROUP BY region;

-- Query 9: Verify distribution across partitions
SELECT 'Query 9: List partition distribution' AS query_description;
SELECT 'north_america' AS partition, COUNT(*) AS rows FROM orders_by_region_north_america
UNION ALL
SELECT 'europe', COUNT(*) FROM orders_by_region_europe
UNION ALL
SELECT 'asia_pacific', COUNT(*) FROM orders_by_region_asia_pacific
UNION ALL
SELECT 'other', COUNT(*) FROM orders_by_region_other
ORDER BY partition;

-- Summary of list partitioning characteristics
SELECT 'LIST Partitioning Summary' AS info;
SELECT
    'orders_by_region' AS table_name,
    'LIST on region (4 partitions)' AS partition_strategy,
    'north_america, europe, asia_pacific, other' AS partition_values,
    'Categorical data with known discrete values' AS ideal_use_case;
