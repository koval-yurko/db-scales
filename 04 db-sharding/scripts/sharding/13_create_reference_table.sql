-- Phase 2: Create Reference Table
-- Reference tables are replicated to all workers for efficient joins

-- Make regions a reference table (replicated to all nodes)
SELECT create_reference_table('regions');

-- Verify reference table
SELECT
    logicalrelid::text AS table_name,
    partmethod AS method,
    'reference' AS type
FROM pg_dist_partition
WHERE partmethod = 'n'
ORDER BY table_name;

-- Note: users table stays as a local table on coordinator
-- This is intentional - demonstrates local vs reference vs distributed
