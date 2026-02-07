-- Phase 3: Backfill read tables from existing data

-- Populate read_revenue_by_region
INSERT INTO read_revenue_by_region (region, total_revenue, order_count, avg_order_value)
SELECT
    region,
    SUM(total_amount),
    COUNT(*),
    AVG(total_amount)
FROM orders
WHERE status != 'cancelled'
GROUP BY region
ON CONFLICT (region) DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,
    order_count = EXCLUDED.order_count,
    avg_order_value = EXCLUDED.avg_order_value,
    last_updated = CURRENT_TIMESTAMP;

-- Populate read_top_products
INSERT INTO read_top_products (product_id, product_name, category, total_sold, total_revenue)
SELECT
    p.id,
    p.name,
    p.category,
    SUM(oi.quantity),
    SUM(oi.line_total)
FROM order_items oi
JOIN products p ON oi.product_id = p.id
JOIN orders o ON oi.order_id = o.id
WHERE o.status != 'cancelled'
GROUP BY p.id, p.name, p.category
ON CONFLICT (product_id) DO UPDATE SET
    product_name = EXCLUDED.product_name,
    category = EXCLUDED.category,
    total_sold = EXCLUDED.total_sold,
    total_revenue = EXCLUDED.total_revenue,
    last_updated = CURRENT_TIMESTAMP;

-- Populate read_user_spending
INSERT INTO read_user_spending (user_id, user_name, region_code, tier, total_spent, order_count, avg_order_value, last_order_at)
SELECT
    u.id,
    u.name,
    u.region_code,
    u.tier,
    COALESCE(SUM(o.total_amount), 0),
    COUNT(o.id),
    COALESCE(AVG(o.total_amount), 0),
    MAX(o.created_at)
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status != 'cancelled'
GROUP BY u.id, u.name, u.region_code, u.tier
ON CONFLICT (user_id) DO UPDATE SET
    user_name = EXCLUDED.user_name,
    region_code = EXCLUDED.region_code,
    tier = EXCLUDED.tier,
    total_spent = EXCLUDED.total_spent,
    order_count = EXCLUDED.order_count,
    avg_order_value = EXCLUDED.avg_order_value,
    last_order_at = EXCLUDED.last_order_at,
    last_updated = CURRENT_TIMESTAMP;

-- Populate read_daily_stats
INSERT INTO read_daily_stats (stat_date, order_count, total_revenue, unique_customers, avg_order_value)
SELECT
    DATE(o.created_at),
    COUNT(*),
    SUM(o.total_amount),
    COUNT(DISTINCT o.user_id),
    AVG(o.total_amount)
FROM orders o
WHERE o.status != 'cancelled'
GROUP BY DATE(o.created_at)
ON CONFLICT (stat_date) DO UPDATE SET
    order_count = EXCLUDED.order_count,
    total_revenue = EXCLUDED.total_revenue,
    unique_customers = EXCLUDED.unique_customers,
    avg_order_value = EXCLUDED.avg_order_value,
    last_updated = CURRENT_TIMESTAMP;
