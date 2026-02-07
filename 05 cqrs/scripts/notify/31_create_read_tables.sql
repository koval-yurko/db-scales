-- Phase 4: Ensure read tables exist (reuse from Phase 3 if present)
-- This script is idempotent — only creates tables that don't already exist

CREATE TABLE IF NOT EXISTS read_revenue_by_region (
    region VARCHAR(20) PRIMARY KEY,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS read_top_products (
    product_id INTEGER PRIMARY KEY,
    product_name VARCHAR(100),
    category VARCHAR(50),
    total_sold INTEGER DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS read_user_spending (
    user_id INTEGER PRIMARY KEY,
    user_name VARCHAR(100),
    region_code VARCHAR(10),
    tier VARCHAR(20),
    total_spent DECIMAL(14,2) DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    last_order_at TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS read_daily_stats (
    stat_date DATE PRIMARY KEY,
    order_count INTEGER DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    unique_customers INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    top_region VARCHAR(20),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
