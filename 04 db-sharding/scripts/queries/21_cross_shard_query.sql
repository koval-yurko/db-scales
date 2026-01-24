-- Cross-Shard Queries (Multi-Shard)
-- These queries execute in parallel across all workers
-- In Citus, EXPLAIN will show "Task: adaptive executor"

-- Query 1: Total orders across all users
SELECT COUNT(*) as total_orders, SUM(amount) as total_revenue
FROM orders;

-- Query 2: EXPLAIN ANALYZE cross-shard aggregation
EXPLAIN (ANALYZE, COSTS)
SELECT COUNT(*) FROM orders;

-- Query 3: Group by region (executed in parallel, aggregated on coordinator)
SELECT
    region,
    COUNT(*) as order_count,
    SUM(amount) as total_revenue,
    AVG(amount) as avg_order_value
FROM orders
GROUP BY region
ORDER BY total_revenue DESC;

-- Query 4: Group by status
SELECT status, COUNT(*), SUM(amount)
FROM orders
GROUP BY status
ORDER BY COUNT(*) DESC;

-- Query 5: Recent orders across all users (scatter-gather)
SELECT id, user_id, region, amount, status, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 20;

-- Query 6: EXPLAIN scatter-gather query
EXPLAIN (COSTS OFF)
SELECT id, user_id, region, amount
FROM orders
ORDER BY created_at DESC
LIMIT 20;

-- Query 7: Distinct values (parallel execution)
SELECT DISTINCT region FROM orders ORDER BY region;

-- Query 8: Count by multiple dimensions
SELECT
    region,
    status,
    COUNT(*) as count
FROM orders
GROUP BY region, status
ORDER BY region, status;
