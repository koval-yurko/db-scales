-- ========================================
-- Initial Seed Data (BEFORE Partitioning)
-- ========================================
-- This script inserts initial data into non-partitioned tables.
-- This data will be migrated to partitioned tables later.

-- 1. Insert event logs (distributed across months)
INSERT INTO event_logs (event_type, user_id, event_data, ip_address, created_at)
SELECT
    (ARRAY['login', 'logout', 'page_view', 'purchase', 'signup'])[floor(random() * 5 + 1)],
    floor(random() * 1000 + 1)::int,
    jsonb_build_object('session_id', 'sess_' || floor(random() * 9000 + 1000)::text),
    (floor(random() * 255 + 1)::text || '.' ||
     floor(random() * 255 + 1)::text || '.' ||
     floor(random() * 255 + 1)::text || '.' ||
     floor(random() * 255 + 1)::text)::inet,
    timestamp '2024-01-01' + (random() * (timestamp '2024-04-01' - timestamp '2024-01-01'))
FROM generate_series(1, 300);

-- 2. Insert users (distributed across countries)
INSERT INTO users_distributed (username, email, country_code, registration_date, status)
SELECT
    'user_' || lpad(i::text, 5, '0'),
    'user_' || lpad(i::text, 5, '0') || '@example.com',
    (ARRAY['US', 'CA', 'UK', 'DE', 'FR', 'JP', 'AU'])[floor(random() * 7 + 1)],
    (date '2024-01-01' + (random() * 180)::int),
    (ARRAY['active', 'inactive'])[floor(random() * 2 + 1)]
FROM generate_series(1, 200) AS i;

-- 3. Insert orders (distributed across regions)
INSERT INTO orders_by_region (order_number, user_id, product_id, region, order_total, order_status, created_at)
SELECT
    'ORD-' || lpad((100000 + i)::text, 6, '0'),
    floor(random() * 1000 + 1)::int,
    floor(random() * 500 + 1)::int,
    (ARRAY['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'JP', 'CN', 'AU'])[floor(random() * 9 + 1)],
    (random() * 4980 + 20)::numeric(10,2),
    (ARRAY['pending', 'processing', 'shipped', 'delivered'])[floor(random() * 4 + 1)],
    timestamp '2024-01-01' + (random() * (timestamp '2024-04-01' - timestamp '2024-01-01'))
FROM generate_series(1, 250) AS i;

-- 4. Insert sales (distributed across quarters and categories)
INSERT INTO sales_data (sale_date, product_category, product_id, quantity, unit_price, total_amount, store_id)
SELECT
    (date '2024-01-01' + (random() * 180)::int),
    (ARRAY['electronics', 'computers', 'clothing', 'shoes', 'accessories'])[floor(random() * 5 + 1)],
    floor(random() * 500 + 1)::int,
    floor(random() * 10 + 1)::int,
    (random() * 490 + 10)::numeric(10,2),
    0, -- Will be calculated next
    floor(random() * 100 + 1)::int
FROM generate_series(1, 350);

-- Update total_amount based on quantity and unit_price
UPDATE sales_data SET total_amount = quantity * unit_price;

-- Display summary
SELECT 'event_logs' AS table_name, COUNT(*) AS row_count FROM event_logs
UNION ALL
SELECT 'users_distributed', COUNT(*) FROM users_distributed
UNION ALL
SELECT 'orders_by_region', COUNT(*) FROM orders_by_region
UNION ALL
SELECT 'sales_data', COUNT(*) FROM sales_data;
