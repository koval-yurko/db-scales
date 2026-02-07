-- Phase 3: Trigger functions for synchronous read model updates

-- Trigger: sync on order INSERT
CREATE OR REPLACE FUNCTION sync_read_models_on_order_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- Update revenue by region
    INSERT INTO read_revenue_by_region (region, total_revenue, order_count, avg_order_value)
    VALUES (NEW.region, NEW.total_amount, 1, NEW.total_amount)
    ON CONFLICT (region) DO UPDATE SET
        total_revenue = read_revenue_by_region.total_revenue + NEW.total_amount,
        order_count = read_revenue_by_region.order_count + 1,
        avg_order_value = (read_revenue_by_region.total_revenue + NEW.total_amount)
                        / (read_revenue_by_region.order_count + 1),
        last_updated = CURRENT_TIMESTAMP;

    -- Update user spending
    INSERT INTO read_user_spending (user_id, total_spent, order_count, avg_order_value, last_order_at)
    VALUES (NEW.user_id, NEW.total_amount, 1, NEW.total_amount, NEW.created_at)
    ON CONFLICT (user_id) DO UPDATE SET
        total_spent = read_user_spending.total_spent + NEW.total_amount,
        order_count = read_user_spending.order_count + 1,
        avg_order_value = (read_user_spending.total_spent + NEW.total_amount)
                        / (read_user_spending.order_count + 1),
        last_order_at = GREATEST(read_user_spending.last_order_at, NEW.created_at),
        last_updated = CURRENT_TIMESTAMP;

    -- Update daily stats
    INSERT INTO read_daily_stats (stat_date, order_count, total_revenue, unique_customers, avg_order_value)
    VALUES (DATE(NEW.created_at), 1, NEW.total_amount, 1, NEW.total_amount)
    ON CONFLICT (stat_date) DO UPDATE SET
        order_count = read_daily_stats.order_count + 1,
        total_revenue = read_daily_stats.total_revenue + NEW.total_amount,
        avg_order_value = (read_daily_stats.total_revenue + NEW.total_amount)
                        / (read_daily_stats.order_count + 1),
        last_updated = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: sync on order_items INSERT (for product tracking)
CREATE OR REPLACE FUNCTION sync_read_models_on_item_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_product_name VARCHAR(100);
    v_category VARCHAR(50);
BEGIN
    SELECT name, category INTO v_product_name, v_category
    FROM products WHERE id = NEW.product_id;

    INSERT INTO read_top_products (product_id, product_name, category, total_sold, total_revenue)
    VALUES (NEW.product_id, v_product_name, v_category, NEW.quantity, NEW.line_total)
    ON CONFLICT (product_id) DO UPDATE SET
        total_sold = read_top_products.total_sold + NEW.quantity,
        total_revenue = read_top_products.total_revenue + NEW.line_total,
        last_updated = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers
CREATE TRIGGER trg_order_insert_sync
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sync_read_models_on_order_insert();

CREATE TRIGGER trg_item_insert_sync
    AFTER INSERT ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION sync_read_models_on_item_insert();
