-- Phase 2: Enable Citus Extension on Workers
-- This must be run on each worker node before they can be added to the cluster

-- Enable Citus extension
CREATE EXTENSION IF NOT EXISTS citus;

-- Configure Citus node settings
ALTER SYSTEM SET citus.node_conninfo = 'sslmode=prefer';
SELECT pg_reload_conf();

-- Verify Citus is active
SELECT citus_version();
