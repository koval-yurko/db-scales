-- =============================================================================
-- 14_cleanup_repartition.sql
-- Restores the database to its original partitioned state after re-partitioning demos
-- Run this after testing scenarios 10-13 to reset for fresh testing
-- =============================================================================

SELECT 'Starting cleanup of re-partitioning changes...' AS info;

-- =============================================================================
-- Step 1: Cleanup the split partition (11_split_partition.sql changes)
-- Restore event_logs_2024_02 from weekly back to monthly
-- =============================================================================

-- Check if weekly partitions exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'event_logs_2024_02_week1') THEN
        -- Save data from weekly partitions
        CREATE TEMP TABLE temp_feb_data AS
        SELECT * FROM event_logs
        WHERE created_at >= '2024-02-01' AND created_at < '2024-03-01';

        -- Detach the sub-partitioned February partition
        ALTER TABLE event_logs DETACH PARTITION event_logs_2024_02;

        -- Drop the sub-partitioned structure
        DROP TABLE event_logs_2024_02 CASCADE;

        -- Recreate as simple partition
        CREATE TABLE event_logs_2024_02 PARTITION OF event_logs
            FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

        -- Create indexes
        CREATE INDEX idx_event_logs_2024_02_created_at ON event_logs_2024_02 (created_at);
        CREATE INDEX idx_event_logs_2024_02_event_type ON event_logs_2024_02 (event_type);

        -- Restore data
        INSERT INTO event_logs (id, event_type, user_id, event_data, ip_address, created_at)
        SELECT id, event_type, user_id, event_data, ip_address, created_at FROM temp_feb_data;

        DROP TABLE temp_feb_data;

        RAISE NOTICE 'Restored event_logs_2024_02 from weekly to monthly partition';
    END IF;
END $$;

-- =============================================================================
-- Step 2: Cleanup the archive table (12_detach_archive.sql changes)
-- =============================================================================

-- Drop archive table if exists
DROP TABLE IF EXISTS event_logs_archive;
SELECT 'Dropped event_logs_archive table' AS info WHERE EXISTS (SELECT 1);

-- Recreate January partition if it was detached
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_inherits
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE child.relname = 'event_logs_2024_01'
    ) THEN
        -- Create the January partition
        CREATE TABLE event_logs_2024_01 PARTITION OF event_logs
            FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

        -- Create indexes
        CREATE INDEX idx_event_logs_2024_01_created_at ON event_logs_2024_01 (created_at);
        CREATE INDEX idx_event_logs_2024_01_event_type ON event_logs_2024_01 (event_type);

        -- Re-seed with some January data
        INSERT INTO event_logs (event_type, user_id, event_data, ip_address, created_at)
        SELECT
            (ARRAY['user_login', 'page_view', 'api_call', 'user_logout', 'error'])[floor(random() * 5 + 1)],
            floor(random() * 1000 + 1)::INTEGER,
            jsonb_build_object('restored', true, 'index', generate_series),
            ('192.168.' || floor(random() * 255) || '.' || floor(random() * 255))::INET,
            '2024-01-01'::timestamp + (random() * interval '30 days')
        FROM generate_series(1, 50);

        RAISE NOTICE 'Recreated event_logs_2024_01 partition with sample data';
    END IF;
END $$;

-- =============================================================================
-- Step 3: Cleanup the new partition (10_add_new_partition.sql changes)
-- =============================================================================

-- Drop January 2025 partition if exists (added by repartition add scenario)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_inherits
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE child.relname = 'event_logs_2025_01'
    ) THEN
        ALTER TABLE event_logs DETACH PARTITION event_logs_2025_01;
        DROP TABLE event_logs_2025_01;
        RAISE NOTICE 'Dropped event_logs_2025_01 partition';
    END IF;
END $$;

-- =============================================================================
-- Step 4: Cleanup the migrated table (13_migrate_strategy.sql changes)
-- =============================================================================

-- Drop the RANGE partitioned users table
DROP TABLE IF EXISTS users_by_date CASCADE;
SELECT 'Dropped users_by_date table' AS info WHERE EXISTS (SELECT 1);

-- =============================================================================
-- Verification
-- =============================================================================

SELECT 'CLEANUP COMPLETE - Current partition state:' AS info;

SELECT 'event_logs partitions:' AS table_group;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'event_logs'
ORDER BY child.relname;

SELECT 'users_distributed partitions:' AS table_group;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'users_distributed'
ORDER BY child.relname;

-- Verify no leftover tables
SELECT 'Checking for leftover tables...' AS info;
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND (
    tablename LIKE '%_archive%'
    OR tablename LIKE '%_temp%'
    OR tablename = 'users_by_date'
  );

SELECT 'Cleanup verification complete. Database ready for fresh re-partitioning tests.' AS info;
