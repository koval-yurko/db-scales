-- Configure PostgreSQL WAL settings for logical replication
-- These settings require PostgreSQL restart to take effect

-- Enable logical replication
ALTER SYSTEM SET wal_level = 'logical';

-- Set maximum number of replication slots
ALTER SYSTEM SET max_replication_slots = 4;

-- Set maximum number of WAL sender processes
ALTER SYSTEM SET max_wal_senders = 4;

-- Display current settings (will show old values until restart)
SELECT 'PostgreSQL WAL configuration updated.' AS message;
SELECT 'Current settings (before restart):' AS info;
SHOW wal_level;
SHOW max_replication_slots;
SHOW max_wal_senders;

SELECT '' AS separator;
SELECT 'IMPORTANT: Restart PostgreSQL to apply these changes!' AS action_required;
SELECT 'Run: docker-compose restart' AS command;
