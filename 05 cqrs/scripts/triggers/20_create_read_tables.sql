-- Phase 3: Create denormalized read tables

-- Drop materialized views if they exist
DROP MATERIALIZED VIEW IF EXISTS mv_revenue_by_region;
DROP MATERIALIZED VIEW IF EXISTS mv_top_products;
DROP MATERIALIZED VIEW IF EXISTS mv_user_spending;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_stats;

-- Drop read tables if they exist (clean slate)
DROP TABLE IF EXISTS read_revenue_by_region;
DROP TABLE IF EXISTS read_top_products;
DROP TABLE IF EXISTS read_user_spending;
DROP TABLE IF EXISTS read_daily_stats;

-- Revenue by region (denormalized table)
CREATE TABLE read_revenue_by_region (
    region VARCHAR(20) PRIMARY KEY,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Top products (denormalized table)
CREATE TABLE read_top_products (
    product_id INTEGER PRIMARY KEY,
    product_name VARCHAR(100),
    category VARCHAR(50),
    total_sold INTEGER DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User spending (denormalized table)
CREATE TABLE read_user_spending (
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

-- Daily stats (denormalized table)
CREATE TABLE read_daily_stats (
    stat_date DATE PRIMARY KEY,
    order_count INTEGER DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    unique_customers INTEGER DEFAULT 0,
    avg_order_value DECIMAL(10,2) DEFAULT 0,
    top_region VARCHAR(20),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
