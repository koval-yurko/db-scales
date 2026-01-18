-- =============================================================================
-- 12_detach_archive.sql
-- Demonstrates detaching a partition and archiving it to a separate table
-- This is useful for moving old data to cheaper storage or different retention
-- =============================================================================

-- Show current state
SELECT 'BEFORE: Current partitions for event_logs' AS info;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'event_logs'
ORDER BY child.relname;

-- Count rows in January partition before archiving
SELECT 'January 2024 partition row count: ' || COUNT(*) AS info
FROM event_logs_2024_01;

-- Step 1: Create the archive table (standalone, not partitioned)
CREATE TABLE IF NOT EXISTS event_logs_archive (
    id SERIAL,
    event_type VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    event_data JSONB,
    ip_address INET,
    created_at TIMESTAMP NOT NULL,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    archive_reason VARCHAR(100) DEFAULT 'monthly_retention'
);

-- Step 2: Copy data from January partition to archive
INSERT INTO event_logs_archive (id, event_type, user_id, event_data, ip_address, created_at, archive_reason)
SELECT id, event_type, user_id, event_data, ip_address, created_at, 'Q1 2024 archive - January data'
FROM event_logs_2024_01;

SELECT 'Archived ' || COUNT(*) || ' rows to event_logs_archive' AS info
FROM event_logs_archive;

-- Step 3: Detach the January partition from the partitioned table
-- CONCURRENTLY option allows reads during detach (PostgreSQL 14+)
ALTER TABLE event_logs DETACH PARTITION event_logs_2024_01;

-- Step 4: Verify the partition is detached (it's now a standalone table)
SELECT 'Detached partition is now standalone:' AS info;
SELECT
    tablename,
    schemaname
FROM pg_tables
WHERE tablename = 'event_logs_2024_01';

-- Step 5: Drop the detached partition (data is safely in archive)
DROP TABLE event_logs_2024_01;

-- Show the remaining partitions
SELECT 'AFTER: Remaining partitions for event_logs' AS info;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'event_logs'
ORDER BY child.relname;

-- Verify archive table contents
SELECT 'Archive table contents:' AS info;
SELECT
    COUNT(*) AS total_rows,
    MIN(created_at) AS earliest_event,
    MAX(created_at) AS latest_event,
    MIN(archived_at) AS archived_at
FROM event_logs_archive;

-- Demonstrate that January queries now hit the default partition (no data)
SELECT 'Query for January 2024 (now goes to default partition):' AS info;
EXPLAIN (COSTS OFF)
SELECT * FROM event_logs
WHERE created_at >= '2024-01-01' AND created_at < '2024-02-01';

-- Show how to query archived data separately
SELECT 'Querying archived data:' AS info;
SELECT id, event_type, created_at, archived_at
FROM event_logs_archive
ORDER BY created_at
LIMIT 5;
