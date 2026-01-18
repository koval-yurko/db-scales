-- =============================================================================
-- 11_split_partition.sql
-- Demonstrates splitting a monthly partition into weekly partitions
-- This is useful when you need finer granularity for a specific time period
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

-- Step 1: Create a temporary table to hold the February data
CREATE TABLE event_logs_2024_02_temp AS
SELECT * FROM event_logs_2024_02;

SELECT 'Backed up ' || COUNT(*) || ' rows from event_logs_2024_02' AS info
FROM event_logs_2024_02_temp;

-- Step 2: Detach the February partition
ALTER TABLE event_logs DETACH PARTITION event_logs_2024_02;

-- Step 3: Drop the old partition
DROP TABLE event_logs_2024_02;

-- Step 4: Create a sub-partitioned table for February (partition by range on date)
-- First, create an intermediate partition that will hold weekly sub-partitions
CREATE TABLE event_logs_2024_02 PARTITION OF event_logs
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01')
    PARTITION BY RANGE (created_at);

-- Step 5: Create weekly partitions for February 2024
CREATE TABLE event_logs_2024_02_week1 PARTITION OF event_logs_2024_02
    FOR VALUES FROM ('2024-02-01') TO ('2024-02-08');

CREATE TABLE event_logs_2024_02_week2 PARTITION OF event_logs_2024_02
    FOR VALUES FROM ('2024-02-08') TO ('2024-02-15');

CREATE TABLE event_logs_2024_02_week3 PARTITION OF event_logs_2024_02
    FOR VALUES FROM ('2024-02-15') TO ('2024-02-22');

CREATE TABLE event_logs_2024_02_week4 PARTITION OF event_logs_2024_02
    FOR VALUES FROM ('2024-02-22') TO ('2024-03-01');

-- Step 6: Create indexes on the new weekly partitions
CREATE INDEX idx_event_logs_2024_02_week1_created_at ON event_logs_2024_02_week1 (created_at);
CREATE INDEX idx_event_logs_2024_02_week2_created_at ON event_logs_2024_02_week2 (created_at);
CREATE INDEX idx_event_logs_2024_02_week3_created_at ON event_logs_2024_02_week3 (created_at);
CREATE INDEX idx_event_logs_2024_02_week4_created_at ON event_logs_2024_02_week4 (created_at);

-- Step 7: Migrate data from temp table back to the new partitions
INSERT INTO event_logs (id, event_type, user_id, event_data, ip_address, created_at)
SELECT id, event_type, user_id, event_data, ip_address, created_at FROM event_logs_2024_02_temp;

-- Step 8: Verify the migration
SELECT 'Data migrated to weekly partitions:' AS info;
SELECT 'week1' AS partition, COUNT(*) AS rows FROM event_logs_2024_02_week1
UNION ALL
SELECT 'week2', COUNT(*) FROM event_logs_2024_02_week2
UNION ALL
SELECT 'week3', COUNT(*) FROM event_logs_2024_02_week3
UNION ALL
SELECT 'week4', COUNT(*) FROM event_logs_2024_02_week4;

-- Step 9: Drop the temp table
DROP TABLE event_logs_2024_02_temp;

-- Show the new partition hierarchy
SELECT 'AFTER: Partition hierarchy for event_logs' AS info;
WITH RECURSIVE partition_tree AS (
    SELECT
        child.oid,
        child.relname,
        parent.relname AS parent_name,
        1 AS level
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'event_logs'

    UNION ALL

    SELECT
        child.oid,
        child.relname,
        pt.relname AS parent_name,
        pt.level + 1
    FROM pg_inherits
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN partition_tree pt ON pg_inherits.inhparent = pt.oid
)
SELECT
    REPEAT('  ', level - 1) || relname AS partition_hierarchy,
    parent_name,
    level
FROM partition_tree
ORDER BY level, relname;

-- Demonstrate partition pruning with weekly granularity
SELECT 'Query plan for week 2 of February:' AS info;
EXPLAIN (COSTS OFF)
SELECT * FROM event_logs
WHERE created_at >= '2024-02-08' AND created_at < '2024-02-15';
