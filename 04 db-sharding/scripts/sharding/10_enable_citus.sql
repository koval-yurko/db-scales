-- Phase 2: Enable Citus Extension
-- This activates Citus functionality on an existing PostgreSQL database

-- Enable Citus (this activates the preloaded library)
CREATE EXTENSION IF NOT EXISTS citus;

-- Verify Citus is active
SELECT citus_version();

-- Check extension is installed
SELECT * FROM pg_extension WHERE extname = 'citus';
