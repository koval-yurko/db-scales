-- Phase 1: Create base tables (regular PostgreSQL, NO Citus yet)
-- These are standard PostgreSQL tables with standard constraints and indexes

-- Drop existing tables if any (for clean reset)
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS regions CASCADE;

-- Regions lookup table (will become reference table in Phase 2)
CREATE TABLE regions (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    timezone VARCHAR(50),
    currency VARCHAR(3) DEFAULT 'USD'
);

-- Users table (will stay as local table on coordinator)
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100),
    region_code VARCHAR(10) REFERENCES regions(code),
    tier VARCHAR(20) DEFAULT 'standard',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Orders table (will become distributed table in Phase 2)
-- Note: Primary key will need to change when distributed (must include distribution column)
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    region VARCHAR(50) NOT NULL,
    product_id BIGINT,
    quantity INTEGER DEFAULT 1,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Order items table (will become colocated distributed table in Phase 2)
CREATE TABLE order_items (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    product_name VARCHAR(200),
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for common query patterns
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_region ON orders(region);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_user_id ON order_items(user_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_users_region_code ON users(region_code);

-- Verify tables created
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;
