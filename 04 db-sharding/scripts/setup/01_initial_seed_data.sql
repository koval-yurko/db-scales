-- Phase 1: Seed initial data (regular PostgreSQL)
-- This data exists BEFORE Citus is enabled, demonstrating migration path

-- Insert regions
INSERT INTO regions (code, name, timezone, currency) VALUES
    ('US-EAST', 'US East', 'America/New_York', 'USD'),
    ('US-WEST', 'US West', 'America/Los_Angeles', 'USD'),
    ('EU-WEST', 'Europe West', 'Europe/London', 'EUR'),
    ('EU-CENT', 'Europe Central', 'Europe/Berlin', 'EUR'),
    ('APAC-NE', 'Asia Pacific Northeast', 'Asia/Tokyo', 'JPY'),
    ('APAC-SE', 'Asia Pacific Southeast', 'Asia/Singapore', 'SGD'),
    ('SA-EAST', 'South America East', 'America/Sao_Paulo', 'BRL'),
    ('AF-SOUTH', 'Africa South', 'Africa/Johannesburg', 'ZAR'),
    ('ME-WEST', 'Middle East West', 'Asia/Dubai', 'AED'),
    ('OC-EAST', 'Oceania East', 'Australia/Sydney', 'AUD')
ON CONFLICT (code) DO NOTHING;

-- Verify regions
SELECT * FROM regions ORDER BY code;

-- Note: Users and orders are seeded via Node.js script for more control
-- over distribution patterns (hot users, etc.)
