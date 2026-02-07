-- Phase 2: Refresh all materialized views concurrently

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_by_region;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_products;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_spending;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_stats;
