-- Read model queries (run against materialized views or denormalized tables)
-- These are the CQRS read-side equivalents of the baseline queries

-- Q1: Revenue by region (read model)
SELECT * FROM read_revenue_by_region ORDER BY total_revenue DESC;

-- Q2: Top 10 products (read model)
SELECT * FROM read_top_products ORDER BY total_revenue DESC LIMIT 10;

-- Q3: Top 20 spenders (read model)
SELECT * FROM read_user_spending ORDER BY total_spent DESC LIMIT 20;

-- Q4: Daily stats last 30 days (read model)
SELECT * FROM read_daily_stats ORDER BY stat_date DESC LIMIT 30;
