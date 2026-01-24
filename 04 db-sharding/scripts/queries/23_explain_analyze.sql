-- EXPLAIN ANALYZE Examples
-- Demonstrates how to analyze distributed query execution

-- ============================================
-- 1. ROUTER EXECUTOR (Single-shard queries)
-- ============================================

-- Simple single-shard query
EXPLAIN (ANALYZE, VERBOSE, COSTS, BUFFERS)
SELECT * FROM orders WHERE user_id = 42 LIMIT 10;

-- The output shows:
-- - "Custom Scan (Citus Router)"
-- - "Task Count: 1" (only one shard involved)
-- - Actual execution time on the worker

-- ============================================
-- 2. ADAPTIVE EXECUTOR (Multi-shard queries)
-- ============================================

-- Aggregation across all shards
EXPLAIN (ANALYZE, VERBOSE, COSTS)
SELECT region, COUNT(*), SUM(amount)
FROM orders
GROUP BY region;

-- The output shows:
-- - "Custom Scan (Citus Adaptive)"
-- - "Task Count: 32" (all shards queried in parallel)
-- - Partial aggregation on workers, final aggregation on coordinator

-- Count all rows (parallel execution)
EXPLAIN (ANALYZE, VERBOSE)
SELECT COUNT(*) FROM orders;

-- ============================================
-- 3. DISTRIBUTED PLAN DETAILS
-- ============================================

-- View full distributed plan with costs
EXPLAIN (COSTS ON, FORMAT TEXT)
SELECT
    region,
    status,
    COUNT(*) as count,
    AVG(amount) as avg_amount
FROM orders
GROUP BY region, status
ORDER BY count DESC;

-- ============================================
-- 4. JOIN EXECUTION PLANS
-- ============================================

-- Colocated join (local execution on workers)
EXPLAIN (ANALYZE, COSTS OFF)
SELECT o.id, oi.product_name
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42;

-- Reference table join (no network hop)
EXPLAIN (ANALYZE, COSTS OFF)
SELECT o.id, r.name
FROM orders o
JOIN regions r ON o.region = r.code
WHERE o.user_id = 42;

-- ============================================
-- 5. SUBQUERY EXECUTION
-- ============================================

-- Subquery with distribution column (single shard)
EXPLAIN (COSTS OFF)
SELECT *
FROM orders
WHERE user_id = 42
AND amount > (SELECT AVG(amount) FROM orders WHERE user_id = 42);

-- Subquery without distribution column (multi-shard)
EXPLAIN (COSTS OFF)
SELECT *
FROM orders
WHERE amount > (SELECT AVG(amount) FROM orders);

-- ============================================
-- 6. COMPARISON: DISTRIBUTED VS NON-DISTRIBUTED
-- ============================================

-- When Citus is enabled, compare these query plans:
-- 1. Single-shard: Fast, minimal overhead
-- 2. Multi-shard: Parallel but coordinator aggregation
-- 3. Cross-shard joins: May require data shuffling

-- Query classification helper
SELECT
    CASE
        WHEN query LIKE '%user_id = %' THEN 'Single-shard (router)'
        ELSE 'Multi-shard (adaptive)'
    END as query_type,
    'Check EXPLAIN output for executor type' as note
FROM (SELECT 'SELECT * FROM orders WHERE user_id = 42' as query) q;
