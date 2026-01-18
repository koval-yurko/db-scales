-- =============================================================================
-- 23_composite_queries.sql
-- Example queries demonstrating COMPOSITE partition pruning on sales_data
-- Table: sales_data (partitioned by RANGE on sale_date, then LIST on category)
-- Structure: Quarter (RANGE) -> Category (LIST)
--   - sales_data_2024_q1_electronics
--   - sales_data_2024_q1_clothing
--   - sales_data_2024_q1_other
--   - sales_data_2024_q2_electronics
--   - sales_data_2024_q2_clothing
--   - sales_data_2024_q2_other
-- =============================================================================

-- Query 1: Specific quarter + specific category (single leaf partition)
-- Expected: Only sales_data_2024_q1_electronics is scanned
SELECT 'Query 1: Q1 Electronics (single leaf partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, category, amount, sale_date
FROM sales_data
WHERE sale_date >= '2024-01-01' AND sale_date < '2024-04-01'
  AND category = 'electronics';

-- Query 2: Different quarter + category combination
-- Expected: Only sales_data_2024_q2_clothing is scanned
SELECT 'Query 2: Q2 Clothing (single leaf partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, category, amount, sale_date
FROM sales_data
WHERE sale_date >= '2024-04-01' AND sale_date < '2024-07-01'
  AND category = 'clothing';

-- Query 3: One quarter, all categories (one level of pruning)
-- Expected: All Q1 partitions scanned (electronics, clothing, other)
SELECT 'Query 3: All Q1 sales (three leaf partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, category, amount, sale_date
FROM sales_data
WHERE sale_date >= '2024-01-01' AND sale_date < '2024-04-01';

-- Query 4: One category, all quarters (one level of pruning)
-- Expected: electronics partitions for both Q1 and Q2
SELECT 'Query 4: All Electronics (two leaf partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, category, amount, sale_date
FROM sales_data
WHERE category = 'electronics';

-- Query 5: Multiple categories in one quarter
-- Expected: Two leaf partitions (Q1 electronics + Q1 clothing)
SELECT 'Query 5: Q1 Electronics and Clothing (two leaf partitions)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, category, amount, sale_date
FROM sales_data
WHERE sale_date >= '2024-01-01' AND sale_date < '2024-04-01'
  AND category IN ('electronics', 'clothing');

-- Query 6: Specific month within a quarter
-- Expected: Still scans entire Q1 category partition (monthly granularity within quarter)
SELECT 'Query 6: February Electronics (still Q1 electronics partition)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, category, amount, sale_date
FROM sales_data
WHERE sale_date >= '2024-02-01' AND sale_date < '2024-03-01'
  AND category = 'electronics';

-- Query 7: Cross-quarter analysis with category filter
-- Expected: electronics partitions for Q1 and Q2
SELECT 'Query 7: H1 2024 Electronics revenue' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT
    EXTRACT(QUARTER FROM sale_date) as quarter,
    SUM(amount) as total_revenue,
    COUNT(*) as sales_count
FROM sales_data
WHERE sale_date >= '2024-01-01' AND sale_date < '2024-07-01'
  AND category = 'electronics'
GROUP BY EXTRACT(QUARTER FROM sale_date);

-- Query 8: Category comparison within a quarter
-- Expected: All Q2 partitions (for grouping by category)
SELECT 'Query 8: Q2 sales by category comparison' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT
    category,
    COUNT(*) as sales_count,
    SUM(amount) as total_revenue,
    AVG(amount) as avg_sale
FROM sales_data
WHERE sale_date >= '2024-04-01' AND sale_date < '2024-07-01'
GROUP BY category
ORDER BY total_revenue DESC;

-- Query 9: High-value sales in specific quarter/category
-- Expected: Single leaf partition with amount filter
SELECT 'Query 9: High-value Q1 Electronics (>500)' AS query_description;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, product_name, amount, sale_date
FROM sales_data
WHERE sale_date >= '2024-01-01' AND sale_date < '2024-04-01'
  AND category = 'electronics'
  AND amount > 500
ORDER BY amount DESC;

-- Query 10: Verify distribution across all leaf partitions
SELECT 'Query 10: Composite partition distribution' AS query_description;
SELECT 'Q1 electronics' AS partition, COUNT(*) AS rows FROM sales_data_2024_q1_electronics
UNION ALL
SELECT 'Q1 clothing', COUNT(*) FROM sales_data_2024_q1_clothing
UNION ALL
SELECT 'Q1 other', COUNT(*) FROM sales_data_2024_q1_other
UNION ALL
SELECT 'Q2 electronics', COUNT(*) FROM sales_data_2024_q2_electronics
UNION ALL
SELECT 'Q2 clothing', COUNT(*) FROM sales_data_2024_q2_clothing
UNION ALL
SELECT 'Q2 other', COUNT(*) FROM sales_data_2024_q2_other
ORDER BY partition;

-- Summary of composite partitioning characteristics
SELECT 'COMPOSITE Partitioning Summary' AS info;
SELECT
    'sales_data' AS table_name,
    'RANGE(sale_date) -> LIST(category)' AS partition_strategy,
    '6 leaf partitions (2 quarters x 3 categories)' AS structure,
    'Multi-dimensional queries benefit from double pruning' AS key_benefit;
