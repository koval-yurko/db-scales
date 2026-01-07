-- ========================================
-- Range Partitioning Migration
-- ========================================
-- Migrates event_logs from standard table to RANGE partitioned table
-- Partitioned by created_at (monthly partitions)

-- Step 1: Create new partitioned table
CREATE TABLE event_logs_partitioned (
    id BIGSERIAL,
    event_type VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    event_data JSONB,
    ip_address INET,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Step 2: Create monthly partitions for 2024
CREATE TABLE event_logs_2024_01 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE event_logs_2024_02 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE event_logs_2024_03 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE event_logs_2024_04 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE event_logs_2024_05 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE event_logs_2024_06 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE event_logs_2024_07 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE event_logs_2024_08 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE event_logs_2024_09 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE event_logs_2024_10 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE event_logs_2024_11 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE event_logs_2024_12 PARTITION OF event_logs_partitioned
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- Default partition for dates outside specified ranges
CREATE TABLE event_logs_default PARTITION OF event_logs_partitioned DEFAULT;

-- Step 3: Create indexes on each partition
CREATE INDEX idx_event_logs_2024_01_event_type ON event_logs_2024_01(event_type);
CREATE INDEX idx_event_logs_2024_01_user_id ON event_logs_2024_01(user_id);

CREATE INDEX idx_event_logs_2024_02_event_type ON event_logs_2024_02(event_type);
CREATE INDEX idx_event_logs_2024_02_user_id ON event_logs_2024_02(user_id);

CREATE INDEX idx_event_logs_2024_03_event_type ON event_logs_2024_03(event_type);
CREATE INDEX idx_event_logs_2024_03_user_id ON event_logs_2024_03(user_id);

CREATE INDEX idx_event_logs_default_event_type ON event_logs_default(event_type);
CREATE INDEX idx_event_logs_default_user_id ON event_logs_default(user_id);

-- Step 4: Migrate data from old table to new partitioned table
INSERT INTO event_logs_partitioned
SELECT * FROM event_logs;

-- Step 5: Rename old table to preserve it
ALTER TABLE event_logs RENAME TO event_logs_old;

-- Step 6: Rename partitioned table to original name
ALTER TABLE event_logs_partitioned RENAME TO event_logs;

-- Display migration summary
SELECT 'Range partitioning migration completed for event_logs' AS status;
SELECT 'Old table preserved as event_logs_old' AS note;
