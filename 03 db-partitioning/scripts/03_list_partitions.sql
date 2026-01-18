-- ========================================
-- List Partitioning Migration
-- ========================================
-- Migrates orders_by_region from standard table to LIST partitioned table
-- Partitioned by region (geographic partitions)

-- Step 1: Create new partitioned table
CREATE TABLE orders_by_region_partitioned (
    id BIGSERIAL,
    order_number VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    region VARCHAR(20) NOT NULL,
    order_total DECIMAL(10,2) NOT NULL,
    order_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, region)
) PARTITION BY LIST (region);

-- Step 2: Create regional partitions
CREATE TABLE orders_north_america PARTITION OF orders_by_region_partitioned
    FOR VALUES IN ('US', 'CA', 'MX');

CREATE TABLE orders_europe PARTITION OF orders_by_region_partitioned
    FOR VALUES IN ('UK', 'DE', 'FR', 'IT', 'ES');

CREATE TABLE orders_asia_pacific PARTITION OF orders_by_region_partitioned
    FOR VALUES IN ('JP', 'CN', 'AU', 'IN', 'SG');

CREATE TABLE orders_other PARTITION OF orders_by_region_partitioned DEFAULT;

-- Step 3: Create indexes on each partition
CREATE INDEX idx_orders_north_america_user_id ON orders_north_america(user_id);
CREATE INDEX idx_orders_north_america_status ON orders_north_america(order_status);
CREATE INDEX idx_orders_north_america_created_at ON orders_north_america(created_at);

CREATE INDEX idx_orders_europe_user_id ON orders_europe(user_id);
CREATE INDEX idx_orders_europe_status ON orders_europe(order_status);
CREATE INDEX idx_orders_europe_created_at ON orders_europe(created_at);

CREATE INDEX idx_orders_asia_pacific_user_id ON orders_asia_pacific(user_id);
CREATE INDEX idx_orders_asia_pacific_status ON orders_asia_pacific(order_status);
CREATE INDEX idx_orders_asia_pacific_created_at ON orders_asia_pacific(created_at);

CREATE INDEX idx_orders_other_user_id ON orders_other(user_id);
CREATE INDEX idx_orders_other_status ON orders_other(order_status);
CREATE INDEX idx_orders_other_created_at ON orders_other(created_at);

-- Step 4: Migrate data from old table to new partitioned table
INSERT INTO orders_by_region_partitioned
SELECT * FROM orders_by_region;

-- Step 5: Rename old table to preserve it
ALTER TABLE orders_by_region RENAME TO orders_by_region_old;

-- Step 6: Rename partitioned table to original name
ALTER TABLE orders_by_region_partitioned RENAME TO orders_by_region;

-- Display migration summary
SELECT 'List partitioning migration completed for orders_by_region' AS status;
SELECT 'Old table preserved as orders_by_region_old' AS note;
