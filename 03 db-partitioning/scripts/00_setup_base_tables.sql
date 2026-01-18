-- ========================================
-- Base Tables Setup (NO Partitioning)
-- ========================================
-- This script creates regular, non-partitioned tables.
-- Partitioning will be applied later to simulate real-world migration.

-- 1. Event Logs Table (will become RANGE partitioned)
CREATE TABLE IF NOT EXISTS event_logs (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    event_data JSONB,
    ip_address INET,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_event_type ON event_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_event_logs_user_id ON event_logs(user_id);

-- 2. Users Distributed Table (will become HASH partitioned)
CREATE TABLE IF NOT EXISTS users_distributed (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    country_code VARCHAR(2),
    registration_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_users_distributed_username ON users_distributed(username);
CREATE INDEX IF NOT EXISTS idx_users_distributed_email ON users_distributed(email);

-- 3. Orders by Region Table (will become LIST partitioned)
CREATE TABLE IF NOT EXISTS orders_by_region (
    id BIGSERIAL PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    region VARCHAR(20) NOT NULL,
    order_total DECIMAL(10,2) NOT NULL,
    order_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_by_region_user_id ON orders_by_region(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_by_region_status ON orders_by_region(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_by_region_region ON orders_by_region(region);

-- 4. Sales Data Table (will become COMPOSITE partitioned)
CREATE TABLE IF NOT EXISTS sales_data (
    id BIGSERIAL PRIMARY KEY,
    sale_date DATE NOT NULL,
    product_category VARCHAR(50) NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    store_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sales_data_sale_date ON sales_data(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_data_category ON sales_data(product_category);
CREATE INDEX IF NOT EXISTS idx_sales_data_product_id ON sales_data(product_id);

-- Display created tables
SELECT 'Base tables created successfully' AS status;
