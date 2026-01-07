-- ========================================
-- Hash Partitioning Migration
-- ========================================
-- Migrates users_distributed from standard table to HASH partitioned table
-- Partitioned by id (4 partitions for even distribution)

-- Step 1: Create new partitioned table
CREATE TABLE users_distributed_partitioned (
    id SERIAL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    country_code VARCHAR(2),
    registration_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'active',
    PRIMARY KEY (id)
) PARTITION BY HASH (id);

-- Step 2: Create 4 hash partitions for even distribution
CREATE TABLE users_distributed_p0 PARTITION OF users_distributed_partitioned
    FOR VALUES WITH (MODULUS 4, REMAINDER 0);

CREATE TABLE users_distributed_p1 PARTITION OF users_distributed_partitioned
    FOR VALUES WITH (MODULUS 4, REMAINDER 1);

CREATE TABLE users_distributed_p2 PARTITION OF users_distributed_partitioned
    FOR VALUES WITH (MODULUS 4, REMAINDER 2);

CREATE TABLE users_distributed_p3 PARTITION OF users_distributed_partitioned
    FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- Step 3: Create indexes on each partition
CREATE INDEX idx_users_distributed_p0_username ON users_distributed_p0(username);
CREATE INDEX idx_users_distributed_p0_email ON users_distributed_p0(email);

CREATE INDEX idx_users_distributed_p1_username ON users_distributed_p1(username);
CREATE INDEX idx_users_distributed_p1_email ON users_distributed_p1(email);

CREATE INDEX idx_users_distributed_p2_username ON users_distributed_p2(username);
CREATE INDEX idx_users_distributed_p2_email ON users_distributed_p2(email);

CREATE INDEX idx_users_distributed_p3_username ON users_distributed_p3(username);
CREATE INDEX idx_users_distributed_p3_email ON users_distributed_p3(email);

-- Step 4: Migrate data from old table to new partitioned table
INSERT INTO users_distributed_partitioned (id, username, email, country_code, registration_date, status)
SELECT id, username, email, country_code, registration_date, status FROM users_distributed;

-- Update sequence to continue from max ID
SELECT setval('users_distributed_partitioned_id_seq', (SELECT MAX(id) FROM users_distributed_partitioned));

-- Step 5: Rename old table to preserve it
ALTER TABLE users_distributed RENAME TO users_distributed_old;

-- Step 6: Rename partitioned table to original name
ALTER TABLE users_distributed_partitioned RENAME TO users_distributed;

-- Display migration summary
SELECT 'Hash partitioning migration completed for users_distributed' AS status;
SELECT 'Old table preserved as users_distributed_old' AS note;
