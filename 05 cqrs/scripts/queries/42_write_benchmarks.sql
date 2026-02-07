-- Write performance benchmark queries
-- Used by demonstrate-queries.js to measure write overhead per sync strategy

-- Count current orders (baseline for benchmark)
SELECT COUNT(*) AS current_order_count FROM orders;

-- Count current order_items
SELECT COUNT(*) AS current_item_count FROM order_items;
