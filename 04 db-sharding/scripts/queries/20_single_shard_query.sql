-- Single-Shard Queries
-- These queries route to a single worker based on the distribution column (user_id)
-- In Citus, EXPLAIN will show "Task: router executor"

-- Query 1: Get all orders for a specific user
SELECT * FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 10;

-- Query 2: EXPLAIN ANALYZE single-shard query
EXPLAIN (ANALYZE, COSTS, VERBOSE)
SELECT * FROM orders WHERE user_id = 42;

-- Query 3: Count orders for a specific user
SELECT COUNT(*), SUM(amount), AVG(amount)
FROM orders
WHERE user_id = 42;

-- Query 4: Get orders with items for specific user (colocated join)
SELECT o.id, o.amount, o.status, oi.product_name, oi.quantity
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42;

-- Query 5: EXPLAIN colocated join (should be local on single worker)
EXPLAIN (COSTS OFF)
SELECT o.id, o.amount, oi.product_name
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42;
