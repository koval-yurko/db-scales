-- =============================================================================
-- 13_migrate_strategy.sql
-- Demonstrates changing partitioning strategy from HASH to RANGE
-- Use case: users_distributed is HASH partitioned, but we want to migrate
-- to RANGE partitioning by registration_date for time-based queries
-- =============================================================================

-- Show current HASH partitioning for users_distributed
SELECT 'BEFORE: Current HASH partitions for users_distributed' AS info;
SELECT
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'users_distributed'
ORDER BY child.relname;

-- Show row distribution in current HASH partitions
SELECT 'Current HASH partition distribution:' AS info;
SELECT 'p0' AS partition, COUNT(*) AS rows FROM users_distributed_p0
UNION ALL
SELECT 'p1', COUNT(*) FROM users_distributed_p1
UNION ALL
SELECT 'p2', COUNT(*) FROM users_distributed_p2
UNION ALL
SELECT 'p3', COUNT(*) FROM users_distributed_p3;

-- Step 1: Create new table with RANGE partitioning by registration_date
CREATE TABLE users_by_date (
    id SERIAL,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    registration_date DATE NOT NULL,
    PRIMARY KEY (id, registration_date)
) PARTITION BY RANGE (registration_date);

-- Step 2: Create quarterly partitions for 2024
CREATE TABLE users_by_date_2024_q1 PARTITION OF users_by_date
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE users_by_date_2024_q2 PARTITION OF users_by_date
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');

CREATE TABLE users_by_date_2024_q3 PARTITION OF users_by_date
    FOR VALUES FROM ('2024-07-01') TO ('2024-10-01');

CREATE TABLE users_by_date_2024_q4 PARTITION OF users_by_date
    FOR VALUES FROM ('2024-10-01') TO ('2025-01-01');

-- Create a default partition for dates outside 2024
CREATE TABLE users_by_date_default PARTITION OF users_by_date DEFAULT;

-- Step 3: Create indexes on partitions
CREATE INDEX idx_users_by_date_2024_q1_reg ON users_by_date_2024_q1 (registration_date);
CREATE INDEX idx_users_by_date_2024_q2_reg ON users_by_date_2024_q2 (registration_date);
CREATE INDEX idx_users_by_date_2024_q3_reg ON users_by_date_2024_q3 (registration_date);
CREATE INDEX idx_users_by_date_2024_q4_reg ON users_by_date_2024_q4 (registration_date);

CREATE INDEX idx_users_by_date_2024_q1_country ON users_by_date_2024_q1 (country_code);
CREATE INDEX idx_users_by_date_2024_q2_country ON users_by_date_2024_q2 (country_code);
CREATE INDEX idx_users_by_date_2024_q3_country ON users_by_date_2024_q3 (country_code);
CREATE INDEX idx_users_by_date_2024_q4_country ON users_by_date_2024_q4 (country_code);

-- Step 4: Migrate data from HASH partitioned table to RANGE partitioned table
INSERT INTO users_by_date (id, username, email, country_code, registration_date)
SELECT id, username, email, country_code, registration_date
FROM users_distributed;

-- Step 5: Compare row counts
SELECT 'Row count comparison:' AS info;
SELECT 'users_distributed (HASH)' AS table_name, COUNT(*) AS row_count FROM users_distributed
UNION ALL
SELECT 'users_by_date (RANGE)', COUNT(*) FROM users_by_date;

-- Show new RANGE partition distribution
SELECT 'New RANGE partition distribution:' AS info;
SELECT '2024_q1' AS partition, COUNT(*) AS rows FROM users_by_date_2024_q1
UNION ALL
SELECT '2024_q2', COUNT(*) FROM users_by_date_2024_q2
UNION ALL
SELECT '2024_q3', COUNT(*) FROM users_by_date_2024_q3
UNION ALL
SELECT '2024_q4', COUNT(*) FROM users_by_date_2024_q4
UNION ALL
SELECT 'default', COUNT(*) FROM users_by_date_default;

-- Demonstrate the benefit of the new partitioning strategy
SELECT 'Query plan comparison - finding users registered in Q1 2024:' AS info;

SELECT 'HASH partitioned (scans all partitions):' AS strategy;
EXPLAIN (COSTS OFF)
SELECT * FROM users_distributed
WHERE registration_date >= '2024-01-01' AND registration_date < '2024-04-01';

SELECT 'RANGE partitioned (partition pruning):' AS strategy;
EXPLAIN (COSTS OFF)
SELECT * FROM users_by_date
WHERE registration_date >= '2024-01-01' AND registration_date < '2024-04-01';

-- Note: Both tables are kept for comparison
-- In production, you would:
-- 1. Verify data integrity
-- 2. Update application to use new table
-- 3. Drop old table when confident

SELECT 'Migration complete. Both tables available for comparison.' AS info;
SELECT 'HASH: users_distributed - good for point lookups by ID' AS note
UNION ALL
SELECT 'RANGE: users_by_date - good for date range queries';
