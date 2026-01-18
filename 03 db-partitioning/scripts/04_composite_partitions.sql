-- ========================================
-- Composite Partitioning Migration
-- ========================================
-- Migrates sales_data from standard table to COMPOSITE partitioned table
-- First level: RANGE by sale_date (quarterly)
-- Second level: LIST by product_category

-- Step 1: Create new partitioned table (first level: RANGE)
CREATE TABLE sales_data_partitioned (
    id BIGSERIAL,
    sale_date DATE NOT NULL,
    product_category VARCHAR(50) NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    store_id INTEGER,
    PRIMARY KEY (id, sale_date, product_category)
) PARTITION BY RANGE (sale_date);

-- Step 2: Create quarterly partitions (first level - also partitioned by LIST)
CREATE TABLE sales_2024_q1 PARTITION OF sales_data_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01')
    PARTITION BY LIST (product_category);

CREATE TABLE sales_2024_q2 PARTITION OF sales_data_partitioned
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01')
    PARTITION BY LIST (product_category);

CREATE TABLE sales_2024_q3 PARTITION OF sales_data_partitioned
    FOR VALUES FROM ('2024-07-01') TO ('2024-10-01')
    PARTITION BY LIST (product_category);

CREATE TABLE sales_2024_q4 PARTITION OF sales_data_partitioned
    FOR VALUES FROM ('2024-10-01') TO ('2025-01-01')
    PARTITION BY LIST (product_category);

-- Step 3: Create category sub-partitions for Q1 (second level)
CREATE TABLE sales_2024_q1_electronics PARTITION OF sales_2024_q1
    FOR VALUES IN ('electronics', 'computers');

CREATE TABLE sales_2024_q1_clothing PARTITION OF sales_2024_q1
    FOR VALUES IN ('clothing', 'shoes', 'accessories');

CREATE TABLE sales_2024_q1_other PARTITION OF sales_2024_q1 DEFAULT;

-- Step 4: Create category sub-partitions for Q2 (second level)
CREATE TABLE sales_2024_q2_electronics PARTITION OF sales_2024_q2
    FOR VALUES IN ('electronics', 'computers');

CREATE TABLE sales_2024_q2_clothing PARTITION OF sales_2024_q2
    FOR VALUES IN ('clothing', 'shoes', 'accessories');

CREATE TABLE sales_2024_q2_other PARTITION OF sales_2024_q2 DEFAULT;

-- Step 5: Create category sub-partitions for Q3 (second level)
CREATE TABLE sales_2024_q3_electronics PARTITION OF sales_2024_q3
    FOR VALUES IN ('electronics', 'computers');

CREATE TABLE sales_2024_q3_clothing PARTITION OF sales_2024_q3
    FOR VALUES IN ('clothing', 'shoes', 'accessories');

CREATE TABLE sales_2024_q3_other PARTITION OF sales_2024_q3 DEFAULT;

-- Step 6: Create category sub-partitions for Q4 (second level)
CREATE TABLE sales_2024_q4_electronics PARTITION OF sales_2024_q4
    FOR VALUES IN ('electronics', 'computers');

CREATE TABLE sales_2024_q4_clothing PARTITION OF sales_2024_q4
    FOR VALUES IN ('clothing', 'shoes', 'accessories');

CREATE TABLE sales_2024_q4_other PARTITION OF sales_2024_q4 DEFAULT;

-- Step 7: Create indexes on leaf partitions
CREATE INDEX idx_sales_2024_q1_electronics_product ON sales_2024_q1_electronics(product_id);
CREATE INDEX idx_sales_2024_q1_electronics_store ON sales_2024_q1_electronics(store_id);

CREATE INDEX idx_sales_2024_q1_clothing_product ON sales_2024_q1_clothing(product_id);
CREATE INDEX idx_sales_2024_q1_clothing_store ON sales_2024_q1_clothing(store_id);

CREATE INDEX idx_sales_2024_q1_other_product ON sales_2024_q1_other(product_id);
CREATE INDEX idx_sales_2024_q1_other_store ON sales_2024_q1_other(store_id);

CREATE INDEX idx_sales_2024_q2_electronics_product ON sales_2024_q2_electronics(product_id);
CREATE INDEX idx_sales_2024_q2_electronics_store ON sales_2024_q2_electronics(store_id);

CREATE INDEX idx_sales_2024_q2_clothing_product ON sales_2024_q2_clothing(product_id);
CREATE INDEX idx_sales_2024_q2_clothing_store ON sales_2024_q2_clothing(store_id);

CREATE INDEX idx_sales_2024_q2_other_product ON sales_2024_q2_other(product_id);
CREATE INDEX idx_sales_2024_q2_other_store ON sales_2024_q2_other(store_id);

-- Step 8: Migrate data from old table to new partitioned table
INSERT INTO sales_data_partitioned
SELECT * FROM sales_data;

-- Step 9: Rename old table to preserve it
ALTER TABLE sales_data RENAME TO sales_data_old;

-- Step 10: Rename partitioned table to original name
ALTER TABLE sales_data_partitioned RENAME TO sales_data;

-- Display migration summary
SELECT 'Composite partitioning migration completed for sales_data' AS status;
SELECT 'Old table preserved as sales_data_old' AS note;
SELECT '4 quarterly partitions created (Q1-Q4)' AS partitions;
SELECT '3 category sub-partitions per quarter' AS sub_partitions;
