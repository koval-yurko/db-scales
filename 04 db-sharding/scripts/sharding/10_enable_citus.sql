-- Phase 2: Enable Citus Extension
-- This activates Citus functionality on an existing PostgreSQL database

-- Enable Citus (this activates the preloaded library)
CREATE EXTENSION IF NOT EXISTS citus;

-- Configure Citus to not require SSL for internal node connections
-- (Required for local Docker network where SSL is not configured)
ALTER SYSTEM SET citus.node_conninfo = 'sslmode=prefer';
SELECT pg_reload_conf();

-- Verify Citus is active
SELECT citus_version();

-- Check extension is installed
SELECT * FROM pg_extension WHERE extname = 'citus';
