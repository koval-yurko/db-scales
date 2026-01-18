-- =============================================================================
-- 10_add_new_partition.sql
-- Demonstrates adding a new partition to an existing partitioned table
-- =============================================================================

-- Show current partitions before changes
SELECT 'BEFORE: Current partitions for event_logs' AS info;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'event_logs'
ORDER BY child.relname;

-- Add a new partition for January 2025
-- This is a common operation when you need to extend your date range for new year
CREATE TABLE IF NOT EXISTS event_logs_2025_01 PARTITION OF event_logs
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Create indexes on the new partition (matching existing partition indexes)
CREATE INDEX IF NOT EXISTS idx_event_logs_2025_01_event_type
    ON event_logs_2025_01 (event_type);
CREATE INDEX IF NOT EXISTS idx_event_logs_2025_01_user_id
    ON event_logs_2025_01 (user_id);

-- Insert some test data into the new partition
INSERT INTO event_logs (event_type, user_id, event_data, ip_address, created_at)
VALUES
    ('user_login', 1001, '{"session": "new_year_session"}', '192.168.1.100', '2025-01-01 00:00:01'),
    ('page_view', 1001, '{"page": "/dashboard"}', '192.168.1.100', '2025-01-05 14:30:00'),
    ('api_call', 1002, '{"endpoint": "/api/data", "method": "GET"}', '192.168.1.101', '2025-01-15 09:15:00'),
    ('user_logout', 1001, '{"reason": "manual"}', '192.168.1.100', '2025-01-20 18:45:00'),
    ('error', 1003, '{"code": 500, "message": "Internal error"}', '192.168.1.102', '2025-01-25 23:00:00');

-- Show partitions after adding new one
SELECT 'AFTER: Partitions for event_logs (showing new 2025_01)' AS info;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'event_logs'
ORDER BY child.relname;

-- Verify data in new partition
SELECT 'Data in new partition (event_logs_2025_01):' AS info;
SELECT id, event_type, user_id, created_at FROM event_logs_2025_01 ORDER BY created_at;

-- Show that queries now include the new partition
SELECT 'Query plan for January 2025 data:' AS info;
EXPLAIN (COSTS OFF)
SELECT * FROM event_logs
WHERE created_at >= '2025-01-01' AND created_at < '2025-02-01';
