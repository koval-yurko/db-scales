-- Phase 4: Replace sync triggers with lightweight NOTIFY triggers

-- Drop sync triggers
DROP TRIGGER IF EXISTS trg_order_insert_sync ON orders;
DROP TRIGGER IF EXISTS trg_item_insert_sync ON order_items;

-- Lightweight NOTIFY trigger on orders
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('order_changes', json_build_object(
        'op', TG_OP,
        'id', NEW.id,
        'user_id', NEW.user_id,
        'region', NEW.region,
        'total_amount', NEW.total_amount,
        'status', NEW.status,
        'created_at', NEW.created_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_notify
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION notify_order_change();

-- Lightweight NOTIFY trigger on order_items
CREATE OR REPLACE FUNCTION notify_item_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('item_changes', json_build_object(
        'op', TG_OP,
        'id', NEW.id,
        'order_id', NEW.order_id,
        'product_id', NEW.product_id,
        'quantity', NEW.quantity,
        'line_total', NEW.line_total
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_notify
    AFTER INSERT ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION notify_item_change();
