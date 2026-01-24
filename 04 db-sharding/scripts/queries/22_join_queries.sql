-- Join Queries
-- Demonstrates different join types: reference, colocated, and cross-shard

-- ============================================
-- 1. REFERENCE TABLE JOINS (Fast - local on each worker)
-- ============================================

-- Join with reference table (regions is replicated on all workers)
SELECT
    o.id,
    o.user_id,
    o.amount,
    o.region,
    r.name as region_name,
    r.timezone,
    r.currency
FROM orders o
JOIN regions r ON o.region = r.code
WHERE o.user_id = 42;

-- EXPLAIN reference table join
EXPLAIN (COSTS OFF)
SELECT o.*, r.name
FROM orders o
JOIN regions r ON o.region = r.code
WHERE o.user_id = 42;

-- Aggregation with reference table join
SELECT
    r.name as region_name,
    r.currency,
    COUNT(*) as order_count,
    SUM(o.amount) as total_revenue
FROM orders o
JOIN regions r ON o.region = r.code
GROUP BY r.name, r.currency
ORDER BY total_revenue DESC;

-- ============================================
-- 2. COLOCATED JOINS (Fast - local on same worker)
-- ============================================

-- Join orders with order_items (both distributed by user_id)
SELECT
    o.id as order_id,
    o.amount as order_total,
    o.status,
    oi.product_name,
    oi.quantity,
    oi.unit_price
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42
ORDER BY o.id, oi.id;

-- EXPLAIN colocated join
EXPLAIN (COSTS OFF)
SELECT o.id, oi.product_name
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42;

-- Aggregation across colocated tables
SELECT
    o.user_id,
    COUNT(DISTINCT o.id) as order_count,
    COUNT(oi.id) as item_count,
    SUM(oi.quantity * oi.unit_price) as calculated_total
FROM orders o
JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id IN (1, 2, 3, 42)
GROUP BY o.user_id
ORDER BY order_count DESC;

-- ============================================
-- 3. LOCAL TABLE JOINS (Requires coordinator)
-- ============================================

-- Join with local users table (data pulled to coordinator)
-- Note: This works but may be slower for large result sets
SELECT
    o.id,
    o.amount,
    u.email,
    u.name,
    u.tier
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 42;

-- EXPLAIN local table join
EXPLAIN (COSTS OFF)
SELECT o.id, u.email
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 42;

-- ============================================
-- 4. COMPLEX MULTI-TABLE JOINS
-- ============================================

-- Join all tables: orders + order_items + regions + users
SELECT
    o.id as order_id,
    u.email,
    u.tier,
    r.name as region_name,
    o.amount,
    o.status,
    COUNT(oi.id) as item_count
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN regions r ON o.region = r.code
LEFT JOIN order_items oi ON o.user_id = oi.user_id AND o.id = oi.order_id
WHERE o.user_id = 42
GROUP BY o.id, u.email, u.tier, r.name, o.amount, o.status
ORDER BY o.id;
