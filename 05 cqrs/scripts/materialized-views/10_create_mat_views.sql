-- Phase 2: Create materialized views for pre-computed analytics

-- Revenue by region (materialized)
CREATE MATERIALIZED VIEW mv_revenue_by_region AS
SELECT
    o.region,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY o.region;

CREATE UNIQUE INDEX idx_mv_revenue_region ON mv_revenue_by_region (region);

-- Top products (materialized)
CREATE MATERIALIZED VIEW mv_top_products AS
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
GROUP BY p.id, p.name, p.category;

CREATE UNIQUE INDEX idx_mv_top_products ON mv_top_products (product_id);

-- User spending (materialized)
CREATE MATERIALIZED VIEW mv_user_spending AS
SELECT
    u.id AS user_id,
    u.name AS user_name,
    u.region_code,
    u.tier,
    COUNT(o.id) AS order_count,
    COALESCE(SUM(o.total_amount), 0) AS total_spent,
    COALESCE(AVG(o.total_amount), 0) AS avg_order_value,
    MAX(o.created_at) AS last_order_at
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status != 'cancelled'
GROUP BY u.id, u.name, u.region_code, u.tier;

CREATE UNIQUE INDEX idx_mv_user_spending ON mv_user_spending (user_id);

-- Daily stats (materialized)
CREATE MATERIALIZED VIEW mv_daily_stats AS
SELECT
    DATE(o.created_at) AS stat_date,
    COUNT(*) AS order_count,
    SUM(o.total_amount) AS total_revenue,
    COUNT(DISTINCT o.user_id) AS unique_customers,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY DATE(o.created_at);

CREATE UNIQUE INDEX idx_mv_daily_stats ON mv_daily_stats (stat_date);
