-- Baseline analytics queries (run against normalized tables via JOINs)

-- Q1: Revenue by region
SELECT
    o.region,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY o.region
ORDER BY total_revenue DESC;

-- Q2: Top 10 products by revenue
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.category,
    SUM(oi.quantity) AS total_sold,
    SUM(oi.line_total) AS total_revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
JOIN orders o ON oi.order_id = o.id
WHERE o.status != 'cancelled'
GROUP BY p.id, p.name, p.category
ORDER BY total_revenue DESC
LIMIT 10;

-- Q3: Top 20 spenders
SELECT
    u.id AS user_id,
    u.name,
    u.region_code,
    u.tier,
    COUNT(o.id) AS order_count,
    SUM(o.total_amount) AS total_spent,
    AVG(o.total_amount) AS avg_order_value,
    MAX(o.created_at) AS last_order_at
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status != 'cancelled'
GROUP BY u.id, u.name, u.region_code, u.tier
ORDER BY total_spent DESC
LIMIT 20;

-- Q4: Daily stats (last 30 days)
SELECT
    DATE(o.created_at) AS stat_date,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    COUNT(DISTINCT o.user_id) AS unique_customers,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY DATE(o.created_at)
ORDER BY stat_date DESC
LIMIT 30;
